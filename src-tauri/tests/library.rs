use paper_vocabulary_lib::{
    db::Database,
    library::cleanup_deleted_pdfs,
    models::{ActionType, HighlightColor, LookupRequest, Paper, PositionData},
    papers,
    usage::{AiResult, TokenUsage},
};
use rusqlite::Connection;
use std::{fs, path::Path};

fn import(db: &Database, root: &Path, title: &str, folder: Option<i64>) -> Paper {
    let source = root.join(format!("{title}.pdf"));
    fs::write(&source, format!("%PDF-1.7\n{title}\n%%EOF")).unwrap();
    papers::import_library_pdf(&source, &root.join("papers"), db, folder).unwrap()
}

fn request(id: &str) -> LookupRequest {
    LookupRequest {
        paper_id: id.into(),
        page_number: 1,
        word: "allocation".into(),
        original_sentence: "Memory allocation.".into(),
        action: ActionType::Translation,
        color: HighlightColor::Blue,
        position: PositionData {
            version: 1,
            start_offset: 7,
            end_offset: 17,
            rects: vec![[10., 20., 90., 35.]],
        },
    }
}

#[test]
fn version_four_migration_exposes_existing_papers_and_preserves_all_data() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let connection = Connection::open(&path).unwrap();
    connection
        .execute_batch(concat!(
            include_str!("../migrations/001_initial.sql"),
            include_str!("../migrations/002_api_usage.sql"),
            include_str!("../migrations/003_vocabulary.sql"),
            include_str!("../migrations/004_reader_tools.sql")
        ))
        .unwrap();
    connection.execute_batch("INSERT INTO papers(id,file_name,file_path,title) VALUES('old','old.pdf','/original/saved.pdf','Old title');
        INSERT INTO vocabulary_entries(id,word,translation,lookup_count) VALUES(1,'allocation','할당',8);
        INSERT INTO vocabulary_contexts(vocabulary_entry_id,paper_id,page_number,original_sentence,action_type,result) VALUES(1,'old',1,'Memory allocation.','translation','할당');
        UPDATE api_credit SET initial_nano_usd = 5000000000;").unwrap();
    let db = Database::open(&path).unwrap();
    assert_eq!(db.library().unwrap().papers[0].paper.title, "Old title");
    assert_eq!(db.library().unwrap().papers[0].folder_id, Some(1));
    assert_eq!(db.paper_path("old").unwrap(), "/original/saved.pdf");
    assert_eq!(db.vocabulary("", None).unwrap()[0].lookup_count, 8);
    assert_eq!(db.usage_summary().unwrap().estimated_balance_usd, Some(5.));
    assert_eq!(
        connection
            .query_row::<i64, _, _>("PRAGMA user_version", [], |r| r.get(0))
            .unwrap(),
        17
    );
    drop(db);
    assert_eq!(
        Database::open(&path)
            .unwrap()
            .library()
            .unwrap()
            .papers
            .len(),
        1
    );
}

#[test]
fn folders_support_nesting_renaming_and_moves_without_cycles_or_duplicate_siblings() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let db = Database::open(&path).unwrap();
    let root = db.create_library_folder(None, " Research ").unwrap();
    let child = db
        .create_library_folder(Some(root.id), "강화 학습")
        .unwrap();
    let grandchild = db.create_library_folder(Some(child.id), "2026").unwrap();
    let other = db.create_library_folder(None, "다른 폴더").unwrap();
    assert!(db.create_library_folder(None, "research").is_err());
    assert!(db.rename_library_folder(other.id, "Research").is_err());
    assert!(db.create_library_folder(Some(-1), "No").is_err());
    for invalid in ["", "  ", "..", "a/b", "a\\b", "line\nbreak"] {
        assert!(db.create_library_folder(None, invalid).is_err());
    }
    assert!(db.create_library_folder(None, &"a".repeat(101)).is_err());
    assert!(db.move_library_folder(root.id, Some(root.id)).is_err());
    assert!(db
        .move_library_folder(root.id, Some(grandchild.id))
        .is_err());
    assert!(db.move_library_folder(root.id, Some(-1)).is_err());
    db.rename_library_folder(child.id, "Robot's 학습").unwrap();
    db.move_library_folder(child.id, Some(other.id)).unwrap();
    drop(db);
    let data = Database::open(&path).unwrap().library().unwrap();
    assert_eq!(
        data.folders
            .iter()
            .find(|f| f.id == child.id)
            .unwrap()
            .parent_id,
        Some(other.id)
    );
    assert_eq!(
        data.folders.iter().find(|f| f.id == child.id).unwrap().name,
        "Robot's 학습"
    );
    assert_eq!(
        data.folders
            .iter()
            .find(|f| f.id == grandchild.id)
            .unwrap()
            .parent_id,
        Some(child.id)
    );
}

#[test]
fn import_move_rename_delete_and_reimport_keep_vocabulary_highlights_costs_and_original() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("papers")).unwrap();
    let path = dir.path().join("data.db");
    let mut db = Database::open(&path).unwrap();
    let folder = db.create_library_folder(None, "논문").unwrap();
    let paper = import(&db, dir.path(), "source", Some(folder.id));
    db.rename_library_paper(&paper.id, "새 논문 제목").unwrap();
    let source = dir.path().join("source.pdf");
    let original = fs::read(&source).unwrap();
    let reopened = papers::import_pdf(&source, &dir.path().join("papers"), &db).unwrap();
    assert_eq!(reopened.title, "새 논문 제목");
    assert_eq!(db.library().unwrap().papers.len(), 1);
    assert_eq!(db.library().unwrap().papers[0].folder_id, Some(folder.id));
    db.move_library_paper(&paper.id, None).unwrap();
    assert!(db.move_library_paper(&paper.id, Some(-1)).is_err());
    assert!(db.rename_library_paper(&paper.id, " ").is_err());
    db.set_initial_credit("5").unwrap();
    let selection = request(&paper.id);
    let saved = db
        .complete_lookup(
            Some(&selection),
            AiResult {
                provider: paper_vocabulary_lib::connection::AiProvider::Api,
                text: "할당".into(),
                response_id: Some("library-test".into()),
                usage: TokenUsage {
                    input: 100,
                    output: 20,
                    cached_input: 0,
                    cache_write: 0,
                    estimated: false,
                },
            },
        )
        .unwrap();
    let cost = db.usage_summary().unwrap().total_cost_usd;
    assert!(cost > 0.);
    assert_eq!(
        db.delete_library_paper(&paper.id).unwrap(),
        vec![paper.id.clone()]
    );
    assert!(!cleanup_deleted_pdfs(&db, &dir.path().join("papers")).unwrap());
    assert!(!Path::new(&db.paper_path(&paper.id).unwrap()).exists());
    assert_eq!(fs::read(&source).unwrap(), original);
    assert!(db.library().unwrap().papers.is_empty());
    assert_eq!(
        db.vocabulary("", None).unwrap()[0].contexts[0].paper_title,
        "새 논문 제목"
    );
    assert_eq!(db.vocabulary("", None).unwrap()[0].lookup_count, 1);
    assert_eq!(
        db.highlights(&paper.id).unwrap()[0].id,
        saved.highlight.unwrap().id
    );
    assert_eq!(db.usage_summary().unwrap().total_cost_usd, cost);
    assert!(db.rename_library_paper(&paper.id, "removed").is_err());
    drop(db);
    let db = Database::open(&path).unwrap();
    assert!(db.library().unwrap().papers.is_empty());
    let restored =
        papers::import_library_pdf(&source, &dir.path().join("papers"), &db, Some(folder.id))
            .unwrap();
    assert_eq!(restored.title, "새 논문 제목");
    assert_eq!(restored.id, paper.id);
    assert_eq!(db.highlights(&paper.id).unwrap().len(), 1);
    assert_eq!(db.usage_summary().unwrap().total_cost_usd, cost);
    assert_eq!(
        fs::read(db.paper_path(&paper.id).unwrap()).unwrap(),
        original
    );
}

#[test]
fn folder_deletion_is_recursive_and_atomic_and_preserves_unrelated_folders() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("papers")).unwrap();
    let path = dir.path().join("data.db");
    let mut db = Database::open(&path).unwrap();
    let a = db.create_library_folder(None, "A").unwrap();
    let child = db.create_library_folder(Some(a.id), "child").unwrap();
    let b = db.create_library_folder(None, "B").unwrap();
    let p1 = import(&db, dir.path(), "one", Some(a.id));
    let p2 = import(&db, dir.path(), "two", Some(child.id));
    let kept = import(&db, dir.path(), "kept", Some(b.id));
    db.save_lookup(&request(&p2.id), "할당").unwrap();
    let connection = Connection::open(&path).unwrap();
    connection.execute_batch("CREATE TRIGGER fail_folder_delete BEFORE DELETE ON library_folders BEGIN SELECT RAISE(FAIL, 'test'); END;").unwrap();
    assert!(db.delete_library_folder(a.id).is_err());
    assert_eq!(db.library().unwrap().papers.len(), 3);
    assert_eq!(db.library().unwrap().folders.len(), 4);
    assert!(db.pending_pdf_deletions().unwrap().is_empty());
    connection
        .execute_batch("DROP TRIGGER fail_folder_delete")
        .unwrap();
    let mut removed = db.delete_library_folder(a.id).unwrap();
    removed.sort();
    let mut expected = vec![p1.id.clone(), p2.id.clone()];
    expected.sort();
    assert_eq!(removed, expected);
    assert!(!cleanup_deleted_pdfs(&db, &dir.path().join("papers")).unwrap());
    let data = db.library().unwrap();
    assert_eq!(data.folders.len(), 2);
    assert!(data.folders.iter().any(|folder| folder.id == b.id));
    assert_eq!(data.papers.len(), 1);
    assert_eq!(data.papers[0].paper.id, kept.id);
    assert_eq!(fs::read_dir(dir.path().join("papers")).unwrap().count(), 1);
    assert_eq!(db.vocabulary("", None).unwrap()[0].lookup_count, 1);
    assert_eq!(db.highlights(&p2.id).unwrap().len(), 1);
    assert_eq!(
        connection
            .query_row::<i64, _, _>("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
                .get(0))
            .unwrap(),
        0
    );
    assert!(db.delete_library_folder(0).is_err());
    assert!(db.delete_library_paper("missing").is_err());
}

#[test]
fn interrupted_file_cleanup_retries_and_reimport_cancels_pending_deletion() {
    let dir = tempfile::tempdir().unwrap();
    let copies = dir.path().join("papers");
    fs::create_dir(&copies).unwrap();
    let path = dir.path().join("data.db");
    let mut db = Database::open(&path).unwrap();
    let paper = import(&db, dir.path(), "retry", None);
    db.delete_library_paper(&paper.id).unwrap();
    let copy = copies.join(format!("{}.pdf", paper.id));
    fs::remove_file(&copy).unwrap();
    fs::create_dir(&copy).unwrap();
    assert!(cleanup_deleted_pdfs(&db, &copies).unwrap());
    drop(db);
    let mut db = Database::open(&path).unwrap();
    assert_eq!(db.pending_pdf_deletions().unwrap(), vec![paper.id.clone()]);
    fs::remove_dir(&copy).unwrap();
    assert!(!cleanup_deleted_pdfs(&db, &copies).unwrap());
    assert!(db.pending_pdf_deletions().unwrap().is_empty());
    let source = dir.path().join("retry.pdf");
    papers::import_pdf(&source, &copies, &db).unwrap();
    db.delete_library_paper(&paper.id).unwrap();
    papers::import_pdf(&source, &copies, &db).unwrap();
    assert!(db.pending_pdf_deletions().unwrap().is_empty());
    assert!(!cleanup_deleted_pdfs(&db, &copies).unwrap());
    assert!(copy.is_file());
    // A historical metadata path must never authorize deletion outside owned copies.
    let connection = Connection::open(path).unwrap();
    connection
        .execute(
            "UPDATE papers SET file_path = ?1",
            [source.to_string_lossy().as_ref()],
        )
        .unwrap();
    db.delete_library_paper(&paper.id).unwrap();
    cleanup_deleted_pdfs(&db, &copies).unwrap();
    assert!(source.is_file());
    assert!(!copy.exists());
}

#[test]
fn metadata_migration_preserves_upload_time_folder_and_history() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("v5.db");
    let connection = Connection::open(&path).unwrap();
    connection
        .execute_batch(concat!(
            include_str!("../migrations/001_initial.sql"),
            include_str!("../migrations/002_api_usage.sql"),
            include_str!("../migrations/003_vocabulary.sql"),
            include_str!("../migrations/004_reader_tools.sql"),
            include_str!("../migrations/005_library.sql")
        ))
        .unwrap();
    connection.execute_batch("INSERT INTO papers(id,file_name,file_path,title,added_at) VALUES('old','old.pdf','/saved.pdf','Custom title','2021-06-07T08:00:00Z');
      INSERT INTO library_folders(id,name) VALUES(1,'Research'); INSERT INTO library_papers VALUES('old',1);
      INSERT INTO vocabulary_entries(word,lookup_count) VALUES('kept',9);
      INSERT INTO vocabulary_contexts(vocabulary_entry_id,paper_id,page_number,original_sentence,action_type,result) VALUES(1,'old',1,'Kept data.','translation','유지');").unwrap();
    let db = Database::open(&path).unwrap();
    let papers = db.library().unwrap().papers;
    assert_eq!(papers[0].uploaded_at, "2021-06-07T08:00:00Z");
    assert_eq!(papers[0].folder_id, Some(1));
    assert_eq!(papers[0].importance, 0);
    assert_eq!(papers[0].authors, "");
    assert_eq!(papers[0].paper.title, "Custom title");
    assert_eq!(db.vocabulary("", None).unwrap()[0].lookup_count, 9);
    assert_eq!(
        connection
            .query_row::<i64, _, _>("PRAGMA user_version", [], |r| r.get(0))
            .unwrap(),
        17
    );
}

#[test]
fn metadata_and_importance_persist_without_overwriting_corrections_or_originals() {
    use paper_vocabulary_lib::library::PaperMetadata;
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("papers")).unwrap();
    let path = dir.path().join("data.db");
    let mut db = Database::open(&path).unwrap();
    let paper = import(&db, dir.path(), "download-123", None);
    let uploaded = "2020-10-08T08:00:00.000Z";
    Connection::open(&path).unwrap().execute("UPDATE papers SET added_at = ?1", [uploaded]).unwrap();
    let value = PaperMetadata {
        title: "Real paper title".into(),
        authors: "Alice, 김연구".into(),
        published_date: "2024-02-29".into(),
    };
    assert_eq!(
        db.update_paper_metadata(&paper.id, &value, true)
            .unwrap()
            .title,
        "Real paper title"
    );
    let manual = PaperMetadata {
        title: "Corrected title".into(),
        authors: "Bob".into(),
        published_date: "2024".into(),
    };
    db.update_paper_metadata(&paper.id, &manual, false).unwrap();
    db.update_paper_metadata(&paper.id, &value, true).unwrap();
    for n in [1, 2, 3, 0, 4, 5] {
        db.set_paper_importance(&paper.id, n).unwrap();
        assert_eq!(db.library().unwrap().papers[0].importance, n);
    }
    for n in [6, 255] {
        assert!(db.set_paper_importance(&paper.id, n).is_err());
    }
    assert!(db.set_paper_importance("missing", 3).is_err());
    for invalid in [
        "2023-02-29",
        "2024-13",
        "2024-01-32",
        "0000",
        "2024-2",
        "bad",
    ] {
        let wrong = PaperMetadata {
            title: "Changed".into(),
            authors: "".into(),
            published_date: invalid.into(),
        };
        assert!(db.update_paper_metadata(&paper.id, &wrong, false).is_err());
        assert_eq!(db.paper(&paper.id).unwrap().title, "Corrected title");
    }
    db.delete_library_paper(&paper.id).unwrap();
    cleanup_deleted_pdfs(&db, &dir.path().join("papers")).unwrap();
    assert!(db.update_paper_metadata(&paper.id, &value, false).is_err());
    drop(db);
    let db = Database::open(&path).unwrap();
    let reimport = papers::import_library_pdf(
        &dir.path().join("download-123.pdf"),
        &dir.path().join("papers"),
        &db,
        None,
    )
    .unwrap();
    assert_eq!(reimport.title, "Corrected title");
    db.update_paper_metadata(&paper.id, &value, true).unwrap();
    let stored = &db.library().unwrap().papers[0];
    assert_eq!(stored.authors, "Bob");
    assert_eq!(stored.published_date, "2024");
    assert_eq!(stored.importance, 5);
    assert!(stored.uploaded_at.as_str() > uploaded);
    assert!(dir.path().join("download-123.pdf").is_file());
}

#[test]
fn default_folder_migration_moves_only_unfiled_papers_and_becomes_an_ordinary_folder() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("v6.db");
    let connection = Connection::open(&path).unwrap();
    connection
        .execute_batch(concat!(
            include_str!("../migrations/001_initial.sql"),
            include_str!("../migrations/002_api_usage.sql"),
            include_str!("../migrations/003_vocabulary.sql"),
            include_str!("../migrations/004_reader_tools.sql"),
            include_str!("../migrations/005_library.sql"),
            include_str!("../migrations/006_paper_metadata.sql")
        ))
        .unwrap();
    connection.execute_batch("INSERT INTO library_folders(id,parent_id,name) VALUES(1,NULL,'기본 폴더'),(2,1,'Existing child');
      INSERT INTO papers(id,file_name,file_path,title) VALUES('loose','loose.pdf','/loose.pdf','Saved title'),('filed','filed.pdf','/filed.pdf','Other title');
      INSERT INTO library_papers VALUES('loose',NULL),('filed',2);").unwrap();
    let db = Database::open(&path).unwrap();
    let data = db.library().unwrap();
    let converted = data
        .folders
        .iter()
        .find(|f| f.name == "기본 폴더 (1)")
        .unwrap();
    assert_eq!(
        data.papers
            .iter()
            .find(|p| p.paper.id == "loose")
            .unwrap()
            .folder_id,
        Some(converted.id)
    );
    assert_eq!(
        data.papers
            .iter()
            .find(|p| p.paper.id == "filed")
            .unwrap()
            .folder_id,
        Some(2)
    );
    db.rename_library_folder(converted.id, "My Papers").unwrap();
    db.move_library_folder(converted.id, Some(2)).unwrap();
    assert!(db.move_library_folder(1, Some(converted.id)).is_err());
    let id = converted.id;
    drop(db);
    let db = Database::open(&path).unwrap();
    let data = db.library().unwrap();
    assert_eq!(data.folders.len(), 3);
    let moved = data.folders.iter().find(|f| f.id == id).unwrap();
    assert_eq!(moved.name, "My Papers");
    assert_eq!(moved.parent_id, Some(2));
    assert_eq!(db.paper("loose").unwrap().title, "Saved title");
    assert_eq!(
        connection
            .query_row::<i64, _, _>("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
                .get(0))
            .unwrap(),
        0
    );
}

#[test]
fn reimport_backfills_empty_metadata_but_preserves_manual_values_and_intentional_blanks() {
    use paper_vocabulary_lib::library::PaperMetadata;
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("papers")).unwrap();
    let db = Database::open(&dir.path().join("data.db")).unwrap();
    let paper = import(&db, dir.path(), "download", None);
    let empty = PaperMetadata {
        title: "".into(),
        authors: "".into(),
        published_date: "".into(),
    };
    db.update_paper_metadata(&paper.id, &empty, true).unwrap();
    let found = PaperMetadata {
        title: "Actual title".into(),
        authors: "Alice, Bob".into(),
        published_date: "2024-05".into(),
    };
    db.update_paper_metadata(&paper.id, &found, true).unwrap();
    assert_eq!(db.library().unwrap().papers[0].authors, "Alice, Bob");
    assert_eq!(db.library().unwrap().papers[0].published_date, "2024-05");
    assert_eq!(db.paper(&paper.id).unwrap().title, "Actual title");
    let manual = PaperMetadata {
        title: "download.pdf".into(),
        ..empty
    };
    db.update_paper_metadata(&paper.id, &manual, false).unwrap();
    db.update_paper_metadata(&paper.id, &found, true).unwrap();
    assert_eq!(db.paper(&paper.id).unwrap().title, "download.pdf");
    assert_eq!(db.library().unwrap().papers[0].authors, "");
    assert_eq!(db.library().unwrap().papers[0].published_date, "");
}

#[test]
fn reopening_repairs_wrong_automatic_title_without_losing_history_or_manual_corrections() {
    use paper_vocabulary_lib::library::PaperMetadata;
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("papers")).unwrap();
    let path = dir.path().join("data.db");
    let mut db = Database::open(&path).unwrap();
    let folder = db.create_library_folder(None, "Research").unwrap();
    let paper = import(&db, dir.path(), "download", Some(folder.id));
    let wrong = PaperMetadata {
        title: "COOPERATION body text from two columns".into(),
        authors: "".into(),
        published_date: "2018-08-20".into(),
    };
    db.update_paper_metadata(&paper.id, &wrong, true).unwrap();
    db.set_paper_importance(&paper.id, 4).unwrap();
    db.save_lookup(&request(&paper.id), "할당").unwrap();
    let before = db.library().unwrap().papers.remove(0);
    let highlights = serde_json::to_value(db.highlights(&paper.id).unwrap()).unwrap();
    let usage = serde_json::to_value(db.usage_summary().unwrap()).unwrap();
    let corrected = PaperMetadata {
        title: "Anonymous Hedonic Game for Task Allocation in a Large-Scale Multiple Agent System"
            .into(),
        authors: "Inmo Jang, Hyo-Sang Shin, and Antonios Tsourdos".into(),
        published_date: "2018-08-20".into(),
    };
    db.update_paper_metadata(&paper.id, &corrected, true)
        .unwrap();
    // An unreadable reimport must not erase a previously recovered title.
    let empty = PaperMetadata {
        title: "".into(),
        authors: "".into(),
        published_date: "".into(),
    };
    db.update_paper_metadata(&paper.id, &empty, true).unwrap();
    drop(db);
    let db = Database::open(&path).unwrap();
    let after = db.library().unwrap().papers.remove(0);
    assert_eq!(after.paper.title, corrected.title);
    assert_eq!(after.authors, corrected.authors);
    assert_eq!(after.folder_id, before.folder_id);
    assert_eq!(after.uploaded_at, before.uploaded_at);
    assert_eq!(after.importance, before.importance);
    assert_eq!(after.published_date, before.published_date);
    assert_eq!(
        serde_json::to_value(db.highlights(&paper.id).unwrap()).unwrap(),
        highlights
    );
    assert_eq!(
        serde_json::to_value(db.usage_summary().unwrap()).unwrap(),
        usage
    );
    assert_eq!(
        db.vocabulary("", None).unwrap()[0].contexts[0].paper_title,
        corrected.title
    );
    db.rename_library_paper(&paper.id, "My chosen title")
        .unwrap();
    db.update_paper_metadata(&paper.id, &wrong, true).unwrap();
    assert_eq!(db.paper(&paper.id).unwrap().title, "My chosen title");
}

#[test]
fn batch_import_continues_after_bad_files_deduplicates_and_preserves_reader_folders() {
    let dir = tempfile::tempdir().unwrap();
    let copies = dir.path().join("papers");
    fs::create_dir(&copies).unwrap();
    let db = Database::open(&dir.path().join("data.db")).unwrap();
    let folder = db.create_library_folder(None, "Batch").unwrap();
    let first = dir.path().join("one.pdf");
    let duplicate = dir.path().join("same.PDF");
    let second = dir.path().join("two.PDF");
    let invalid = dir.path().join("broken.pdf");
    let text = dir.path().join("notes.txt");
    fs::write(&first, b"%PDF-1.7\none\n%%EOF").unwrap();
    fs::copy(&first, &duplicate).unwrap();
    fs::write(&second, b"%PDF-1.7\ntwo\n%%EOF").unwrap();
    fs::write(&invalid, b"Not a PDF").unwrap();
    fs::write(&text, b"%PDF-1.7\nnot allowed").unwrap();
    let sources = vec![
        first.clone(),
        invalid,
        text,
        second.clone(),
        first.clone(),
        duplicate,
        dir.path().join("missing.pdf"),
    ];
    let dropped = papers::dropped_pdfs(&sources).unwrap();
    assert_eq!(dropped.len(), 6);
    let result = papers::import_pdfs(&dropped, &copies, &db, Some(Some(folder.id))).unwrap();
    assert_eq!(result.papers.len(), 2);
    assert_eq!(
        result
            .failures
            .iter()
            .map(|f| f.file_name.as_str())
            .collect::<Vec<_>>(),
        vec!["broken.pdf", "notes.txt", "missing.pdf"]
    );
    assert_eq!(db.library().unwrap().papers.len(), 2);
    assert!(db
        .library()
        .unwrap()
        .papers
        .iter()
        .all(|p| p.folder_id == Some(folder.id)));
    assert_eq!(fs::read_dir(&copies).unwrap().count(), 2);
    db.rename_library_paper(&result.papers[0].id, "Manual title")
        .unwrap();
    db.set_paper_memo(&result.papers[0].id, "한글 메모")
        .unwrap();
    let reader = papers::import_pdfs(&[first.clone(), second], &copies, &db, None).unwrap();
    assert_eq!(reader.papers[0].title, "Manual title");
    assert!(db
        .library()
        .unwrap()
        .papers
        .iter()
        .all(|p| p.folder_id == Some(folder.id)));
    assert!(papers::import_pdfs(&[first], &copies, &db, Some(Some(-1))).is_err());
    assert_eq!(
        db.library()
            .unwrap()
            .papers
            .iter()
            .find(|p| p.paper.id == result.papers[0].id)
            .unwrap()
            .memo,
        "한글 메모"
    );
    assert_eq!(db.usage_summary().unwrap().total_cost_usd, 0.);
}

#[test]
fn batch_moves_are_atomic_and_preserve_paper_metadata_vocabulary_and_restart() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("papers")).unwrap();
    let path = dir.path().join("data.db");
    let mut db = Database::open(&path).unwrap();
    let folder = db.create_library_folder(None, "Destination").unwrap();
    let a = import(&db, dir.path(), "a", None);
    let b = import(&db, dir.path(), "b", None);
    let kept = import(&db, dir.path(), "kept", None);
    db.set_paper_memo(&a.id, "기존 메모").unwrap();
    db.save_lookup(&request(&a.id), "할당").unwrap();
    assert!(db.move_library_papers(&[], Some(folder.id)).is_err());
    assert!(db
        .move_library_papers(&[a.id.clone(), "missing".into()], Some(folder.id))
        .is_err());
    assert!(db
        .move_library_papers(std::slice::from_ref(&a.id), Some(-1))
        .is_err());
    assert!(db
        .library()
        .unwrap()
        .papers
        .iter()
        .all(|p| p.folder_id.is_none()));
    let mut ids = vec![a.id.clone(), b.id.clone()];
    ids.sort();
    let connection = Connection::open(&path).unwrap();
    connection.execute_batch(&format!("CREATE TRIGGER fail_batch_move BEFORE UPDATE ON library_papers WHEN OLD.paper_id = '{}' BEGIN SELECT RAISE(FAIL, 'test'); END;", ids[1])).unwrap();
    assert!(db.move_library_papers(&ids, Some(folder.id)).is_err());
    assert!(db
        .library()
        .unwrap()
        .papers
        .iter()
        .all(|p| p.folder_id.is_none()));
    connection
        .execute_batch("DROP TRIGGER fail_batch_move")
        .unwrap();
    ids.push(a.id.clone());
    db.move_library_papers(&ids, Some(folder.id)).unwrap();
    drop(db);
    let db = Database::open(&path).unwrap();
    let data = db.library().unwrap();
    assert_eq!(
        data.papers
            .iter()
            .filter(|p| p.folder_id == Some(folder.id))
            .count(),
        2
    );
    assert_eq!(
        data.papers
            .iter()
            .find(|p| p.paper.id == kept.id)
            .unwrap()
            .folder_id,
        None
    );
    assert_eq!(
        data.papers
            .iter()
            .find(|p| p.paper.id == a.id)
            .unwrap()
            .memo,
        "기존 메모"
    );
    assert_eq!(db.vocabulary("", None).unwrap()[0].lookup_count, 1);
    assert_eq!(db.highlights(&a.id).unwrap().len(), 1);
}

#[test]
fn batch_deletion_rolls_back_on_failure_and_only_removes_selected_owned_copies() {
    let dir = tempfile::tempdir().unwrap();
    let copies = dir.path().join("papers");
    fs::create_dir(&copies).unwrap();
    let path = dir.path().join("data.db");
    let mut db = Database::open(&path).unwrap();
    let a = import(&db, dir.path(), "a", None);
    let b = import(&db, dir.path(), "b", None);
    let kept = import(&db, dir.path(), "kept", None);
    let ha = db.save_lookup(&request(&a.id), "할당").unwrap();
    let hb = db.save_lookup(&request(&b.id), "할당").unwrap();
    db.set_initial_credit("5").unwrap();
    assert!(db.delete_library_papers(&[]).is_err());
    assert!(db
        .delete_library_papers(&[a.id.clone(), "missing".into()])
        .is_err());
    assert_eq!(db.library().unwrap().papers.len(), 3);
    assert!(db.pending_pdf_deletions().unwrap().is_empty());
    let mut ids = vec![a.id.clone(), b.id.clone()];
    ids.sort();
    let connection = Connection::open(&path).unwrap();
    connection.execute_batch(&format!("CREATE TRIGGER fail_batch_delete BEFORE INSERT ON pending_pdf_deletions WHEN NEW.paper_id = '{}' BEGIN SELECT RAISE(FAIL, 'test'); END;", ids[1])).unwrap();
    assert!(db.delete_library_papers(&ids).is_err());
    assert_eq!(db.library().unwrap().papers.len(), 3);
    assert!(db.pending_pdf_deletions().unwrap().is_empty());
    assert_eq!(fs::read_dir(&copies).unwrap().count(), 3);
    connection
        .execute_batch("DROP TRIGGER fail_batch_delete")
        .unwrap();
    ids.push(a.id.clone());
    assert_eq!(db.delete_library_papers(&ids).unwrap().len(), 2);
    assert!(!cleanup_deleted_pdfs(&db, &copies).unwrap());
    assert_eq!(db.library().unwrap().papers[0].paper.id, kept.id);
    assert_eq!(fs::read_dir(&copies).unwrap().count(), 1);
    assert!(dir.path().join("a.pdf").exists());
    assert!(dir.path().join("b.pdf").exists());
    assert_eq!(db.vocabulary("", None).unwrap()[0].contexts.len(), 2);
    assert_eq!(db.highlights(&a.id).unwrap()[0].id, ha.id);
    assert_eq!(db.highlights(&b.id).unwrap()[0].id, hb.id);
    assert_eq!(db.usage_summary().unwrap().estimated_balance_usd, Some(5.));
    drop(db);
    let db = Database::open(&path).unwrap();
    let restored = papers::import_pdfs(
        &[dir.path().join("a.pdf"), dir.path().join("b.pdf")],
        &copies,
        &db,
        Some(None),
    )
    .unwrap();
    assert_eq!(restored.papers.len(), 2);
    assert_eq!(db.highlights(&a.id).unwrap()[0].id, ha.id);
    assert_eq!(
        connection
            .query_row::<i64, _, _>("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
                .get(0))
            .unwrap(),
        0
    );
}
