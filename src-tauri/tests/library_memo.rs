use paper_vocabulary_lib::{db::Database, library::PaperMetadata, papers};
use rusqlite::{params, Connection};
use std::fs;

#[test]
fn version_seven_migration_preserves_data_and_memos_survive_reopen_move_and_reimport() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let source = dir.path().join("paper.pdf");
    fs::write(&source, b"%PDF-1.7\npaper\n%%EOF").unwrap();
    let copies = dir.path().join("papers");
    fs::create_dir(&copies).unwrap();
    let connection = Connection::open(&path).unwrap();
    connection
        .execute_batch(concat!(
            include_str!("../migrations/001_initial.sql"),
            include_str!("../migrations/002_api_usage.sql"),
            include_str!("../migrations/003_vocabulary.sql"),
            include_str!("../migrations/004_reader_tools.sql"),
            include_str!("../migrations/005_library.sql"),
            include_str!("../migrations/006_paper_metadata.sql"),
            include_str!("../migrations/007_library_folders_and_metadata.sql")
        ))
        .unwrap();
    connection.execute("INSERT INTO papers(id,file_name,file_path,title,authors,published_date,importance,title_manual,metadata_manual,added_at) VALUES('old','old.pdf',?1,'Chosen title','Alice','2023-06',4,1,1,'2020-01-01T00:00:00Z')",[source.to_str().unwrap()]).unwrap();
    connection.execute_batch("INSERT INTO library_papers(paper_id,folder_id) VALUES('old',1);
        INSERT INTO vocabulary_entries(id,word,translation,lookup_count) VALUES(1,'word','단어',3);
        INSERT INTO vocabulary_contexts(id,vocabulary_entry_id,paper_id,page_number,original_sentence,action_type,result) VALUES(1,1,'old',1,'A word.','translation','단어');
        INSERT INTO highlights(paper_id,vocabulary_entry_id,context_id,page_number,selected_text,position_data,color) VALUES('old',1,1,1,'word','{\"version\":1,\"startOffset\":2,\"endOffset\":6,\"rects\":[[10,20,30,40]]}','blue');
        UPDATE api_credit SET initial_nano_usd=5000000000;").unwrap();
    let db = Database::open(&path).unwrap();
    assert_eq!(
        connection
            .query_row::<i64, _, _>("PRAGMA user_version", [], |r| r.get(0))
            .unwrap(),
        16
    );
    let old = &db.library().unwrap().papers[0];
    assert_eq!(old.memo, "");
    assert_eq!(old.paper.title, "Chosen title");
    assert_eq!(old.authors, "Alice");
    assert_eq!(old.published_date, "2023-06");
    assert_eq!(old.importance, 4);
    assert_eq!(old.uploaded_at, "2020-01-01T00:00:00Z");
    let vocabulary = serde_json::to_value(db.vocabulary("", None).unwrap()).unwrap();
    let highlights = serde_json::to_value(db.highlights("old").unwrap()).unwrap();
    let usage = serde_json::to_value(db.usage_summary().unwrap()).unwrap();
    let memo = "  가설 검토 📝\nAuthor's notes: '); DROP TABLE papers; --\n\t다음 주 다시 읽기  ";
    db.set_paper_memo("old", memo).unwrap();
    db.update_paper_metadata(
        "old",
        &PaperMetadata {
            title: "Automatic title".into(),
            authors: "Bob".into(),
            published_date: "2026".into(),
        },
        true,
    )
    .unwrap();
    assert_eq!(db.paper("old").unwrap().title, "Chosen title");
    assert_eq!(
        serde_json::to_value(db.vocabulary("", None).unwrap()).unwrap(),
        vocabulary
    );
    assert_eq!(
        serde_json::to_value(db.highlights("old").unwrap()).unwrap(),
        highlights
    );
    assert_eq!(
        serde_json::to_value(db.usage_summary().unwrap()).unwrap(),
        usage
    );
    let paper = papers::import_library_pdf(&source, &copies, &db, None).unwrap();
    db.set_paper_memo(&paper.id, memo).unwrap();
    let folder = db.create_library_folder(None, "Research").unwrap();
    db.move_library_paper(&paper.id, Some(folder.id)).unwrap();
    papers::import_library_pdf(&source, &copies, &db, Some(folder.id)).unwrap();
    drop(db);
    let db = Database::open(&path).unwrap();
    assert!(db.library().unwrap().papers.iter().all(|p| p.memo == memo));
    let restored = db
        .library()
        .unwrap()
        .papers
        .into_iter()
        .find(|p| p.paper.id == paper.id)
        .unwrap();
    assert_eq!(restored.folder_id, Some(folder.id));
    db.set_paper_memo(&paper.id, "").unwrap();
    assert_eq!(
        db.library()
            .unwrap()
            .papers
            .into_iter()
            .find(|p| p.paper.id == paper.id)
            .unwrap()
            .memo,
        ""
    );
    assert_eq!(fs::read(&source).unwrap(), b"%PDF-1.7\npaper\n%%EOF");
}

#[test]
fn memo_validation_and_failed_saves_leave_existing_values_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let db = Database::open(&path).unwrap();
    let connection = Connection::open(&path).unwrap();
    connection.execute_batch("INSERT INTO papers(id,file_name,file_path,title) VALUES('a','a.pdf','/a','A'),('b','b.pdf','/b','B'); INSERT INTO library_papers(paper_id) VALUES('a');").unwrap();
    db.set_paper_memo("a", "Saved memo").unwrap();
    for value in [
        "x".repeat(10_001),
        "bad\0memo".into(),
        "bad\u{1b}memo".into(),
    ] {
        assert!(db.set_paper_memo("a", &value).is_err());
        assert_eq!(db.library().unwrap().papers[0].memo, "Saved memo");
    }
    assert!(db.set_paper_memo("missing", "text").is_err());
    assert!(db.set_paper_memo("b", "text").is_err());
    connection.execute_batch("CREATE TRIGGER fail_memo BEFORE UPDATE OF memo ON papers BEGIN SELECT RAISE(ABORT,'write failed'); END;").unwrap();
    assert!(db.set_paper_memo("a", "Changed").is_err());
    assert_eq!(
        connection
            .query_row::<String, _, _>("SELECT memo FROM papers WHERE id=?1", params!["a"], |r| r
                .get(0))
            .unwrap(),
        "Saved memo"
    );
    connection.execute_batch("DROP TRIGGER fail_memo;").unwrap();
    db.set_paper_memo("a", &"가".repeat(10_000)).unwrap();
}
