use paper_vocabulary_lib::{
    db::Database,
    history::{HIGHLIGHTS, LIBRARY, VOCABULARY},
    library::{cleanup_deleted_pdfs, PaperMetadata},
    models::{ActionType, HighlightColor, LookupRequest, PositionData},
    papers,
    usage::{AiResult, TokenUsage},
};
use rusqlite::Connection;
use std::{fs, path::Path};
fn fixture() -> (tempfile::TempDir, Database, String) {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("data.db")).unwrap();
    fs::create_dir(dir.path().join("papers")).unwrap();
    fs::write(dir.path().join("source.pdf"), b"%PDF-1.7\nsource\n%%EOF").unwrap();
    let paper = papers::import_pdf(
        &dir.path().join("source.pdf"),
        &dir.path().join("papers"),
        &db,
    )
    .unwrap();
    (dir, db, paper.id)
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
fn state(db: &Database) -> String {
    serde_json::to_string(&db.history_state()).unwrap()
}
fn fk(root: &Path) {
    assert_eq!(
        Connection::open(root.join("data.db"))
            .unwrap()
            .query_row::<i64, _, _>("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r
                .get(0))
            .unwrap(),
        0
    );
}

#[test]
fn vocabulary_undo_redo_restores_all_contexts_highlights_counts_and_cache_without_changing_cost() {
    let (dir, mut db, id) = fixture();
    let root = dir.path();
    let mut q = request(&id);
    let h = db
        .complete_lookup(
            Some(&q),
            AiResult {
                provider: paper_vocabulary_lib::connection::AiProvider::Api,
                text: "할당".into(),
                response_id: Some("history-test".into()),
                usage: TokenUsage {
                    input: 100,
                    cached_input: 0,
                    cache_write: 0,
                    output: 20,
                    estimated: false,
                },
            },
        )
        .unwrap()
        .highlight
        .unwrap();
    assert!(db.usage_summary().unwrap().total_cost_usd > 0.);
    q.action = ActionType::Explanation;
    db.save_lookup(&q, "메모리를 할당합니다.").unwrap();
    q.page_number = 2;
    db.save_lookup(&q, "추가 문맥").unwrap();
    db.set_initial_credit("5").unwrap();
    let before = serde_json::to_string(&db.vocabulary("", None).unwrap()).unwrap();
    let cost = serde_json::to_string(&db.usage_summary().unwrap()).unwrap();
    db.record("삭제", VOCABULARY, |db| {
        db.delete_vocabulary(&[h.vocabulary_entry_id])
    })
    .unwrap();
    assert!(db.vocabulary("", None).unwrap().is_empty());
    assert!(db.highlights(&id).unwrap().is_empty());
    for _ in 0..3 {
        assert_eq!(
            db.restore_history(false, &root.join("papers")).unwrap(),
            Some("삭제".into())
        );
        assert_eq!(
            serde_json::to_string(&db.vocabulary("", None).unwrap()).unwrap(),
            before
        );
        assert_eq!(db.highlights(&id).unwrap().len(), 2);
        assert_eq!(
            db.saved_highlight(&id, h.id).unwrap().text,
            "메모리를 할당합니다."
        );
        fk(root);
        db.restore_history(true, &root.join("papers")).unwrap();
        assert!(db.vocabulary("", None).unwrap().is_empty());
        fk(root);
    }
    db.restore_history(false, &root.join("papers")).unwrap();
    assert!(db.reuse_lookup(&q).unwrap().is_some());
    assert_eq!(
        serde_json::to_string(&db.usage_summary().unwrap()).unwrap(),
        cost
    );
}
#[test]
fn highlight_only_undo_preserves_word_and_restores_exact_color_and_position() {
    let (dir, mut db, id) = fixture();
    let h = db.save_lookup(&request(&id), "할당").unwrap();
    let before = serde_json::to_string(&db.vocabulary("", None).unwrap()).unwrap();
    db.record("하이라이트", HIGHLIGHTS, |db| {
        db.remove_highlights(&id, &[h.id])
    })
    .unwrap();
    db.restore_history(false, &dir.path().join("papers"))
        .unwrap();
    assert_eq!(
        serde_json::to_string(&db.highlights(&id).unwrap()[0]).unwrap(),
        serde_json::to_string(&h).unwrap()
    );
    db.restore_history(true, &dir.path().join("papers"))
        .unwrap();
    assert!(db.highlights(&id).unwrap().is_empty());
    assert_eq!(
        serde_json::to_string(&db.vocabulary("", None).unwrap()).unwrap(),
        before
    );
}
#[test]
fn library_batch_moves_metadata_memo_importance_and_folders_undo_in_order() {
    let (dir, mut db, id) = fixture();
    let root = dir.path();
    let folder = db
        .record("폴더", LIBRARY, |db| {
            db.create_library_folder(None, "Research")
        })
        .unwrap();
    db.record("이동", LIBRARY, |db| {
        db.move_library_papers(std::slice::from_ref(&id), Some(folder.id))
    })
    .unwrap();
    db.record("정보", LIBRARY, |db| {
        db.update_paper_metadata(
            &id,
            &PaperMetadata {
                title: "New title".into(),
                authors: "A Author".into(),
                published_date: "2020-01-01".into(),
            },
            false,
        )
    })
    .unwrap();
    db.record("메모", LIBRARY, |db| db.set_paper_memo(&id, "한글 메모"))
        .unwrap();
    db.record("중요도", LIBRARY, |db| db.set_paper_importance(&id, 5))
        .unwrap();
    db.record("이름", LIBRARY, |db| {
        db.rename_library_folder(folder.id, "Renamed")
    })
    .unwrap();
    for label in ["이름", "중요도", "메모", "정보", "이동", "폴더"] {
        assert_eq!(
            db.restore_history(false, &root.join("papers"))
                .unwrap()
                .as_deref(),
            Some(label)
        );
        fk(root);
    }
    let paper = &db.library().unwrap().papers[0];
    assert_eq!(paper.paper.title, "source.pdf");
    assert_eq!(paper.importance, 0);
    assert!(paper.memo.is_empty());
    assert_eq!(paper.folder_id, None);
    for _ in 0..6 {
        db.restore_history(true, &root.join("papers")).unwrap();
    }
    let library = db.library().unwrap();
    let paper = &library.papers[0];
    assert_eq!(paper.paper.title, "New title");
    assert_eq!(paper.memo, "한글 메모");
    assert_eq!(paper.importance, 5);
    assert_eq!(paper.folder_id, Some(folder.id));
    assert!(library.folders.iter().any(|f| f.name == "Renamed"));
}
#[test]
fn deleting_folder_retains_pdf_for_undo_then_cleans_after_session_ends() {
    let (dir, mut db, id) = fixture();
    let root = dir.path();
    let h = db.save_lookup(&request(&id), "할당").unwrap();
    let parent = db.create_library_folder(None, "Parent").unwrap();
    let child = db.create_library_folder(Some(parent.id), "Child").unwrap();
    db.move_library_paper(&id, Some(child.id)).unwrap();
    db.record("삭제", LIBRARY, |db| db.delete_library_folder(parent.id))
        .unwrap();
    assert!(!cleanup_deleted_pdfs(&db, &root.join("papers")).unwrap());
    assert!(root.join("papers").join(format!("{id}.pdf")).exists());
    assert!(db.library().unwrap().papers.is_empty());
    db.restore_history(false, &root.join("papers")).unwrap();
    assert_eq!(db.library().unwrap().papers[0].folder_id, Some(child.id));
    assert!(db.pending_pdf_deletions().unwrap().is_empty());
    fk(root);
    db.restore_history(true, &root.join("papers")).unwrap();
    drop(db);
    let db = Database::open(&root.join("data.db")).unwrap();
    assert!(db.history_state().undo.is_none());
    cleanup_deleted_pdfs(&db, &root.join("papers")).unwrap();
    assert!(!root.join("papers").join(format!("{id}.pdf")).exists());
    assert!(root.join("source.pdf").exists());
    assert_eq!(db.saved_highlight(&id, h.id).unwrap().text, "할당");
    fk(root);
}
#[test]
fn failed_record_or_restore_is_atomic_and_keeps_history_for_retry() {
    let (dir, mut db, id) = fixture();
    let root = dir.path();
    let h = db.save_lookup(&request(&id), "할당").unwrap();
    let result: Result<(), String> = db.record("실패", LIBRARY, |db| {
        db.set_paper_memo(&id, "not committed")?;
        Err("forced".into())
    });
    assert!(result.is_err());
    assert!(db.library().unwrap().papers[0].memo.is_empty());
    assert!(db.history_state().undo.is_none());
    db.record("삭제", VOCABULARY, |db| {
        db.delete_vocabulary(&[h.vocabulary_entry_id])
    })
    .unwrap();
    let history = state(&db);
    let sql = Connection::open(root.join("data.db")).unwrap();
    sql.execute_batch("CREATE TRIGGER fail_restore BEFORE INSERT ON highlights BEGIN SELECT RAISE(ABORT,'forced'); END;").unwrap();
    assert!(db.restore_history(false, &root.join("papers")).is_err());
    assert!(db.vocabulary("", None).unwrap().is_empty());
    assert_eq!(state(&db), history);
    fk(root);
    sql.execute_batch("DROP TRIGGER fail_restore;").unwrap();
    db.restore_history(false, &root.join("papers")).unwrap();
    assert_eq!(db.highlights(&id).unwrap().len(), 1);
}
#[test]
fn conflicting_data_and_missing_pdf_never_overwrite_current_data_or_advance_history() {
    let (dir, mut db, id) = fixture();
    let root = dir.path();
    let h = db.save_lookup(&request(&id), "할당").unwrap();
    db.record("삭제", VOCABULARY, |db| {
        db.delete_vocabulary(&[h.vocabulary_entry_id])
    })
    .unwrap();
    let mut next = request(&id);
    next.word = "another".into();
    db.save_lookup(&next, "다른").unwrap();
    let sql = Connection::open(root.join("data.db")).unwrap();
    sql.execute(
        "INSERT INTO vocabulary_entries(id,word) VALUES (?1,'conflict')",
        [h.vocabulary_entry_id],
    )
    .unwrap();
    let before = serde_json::to_string(&db.vocabulary("", None).unwrap()).unwrap();
    let history = state(&db);
    assert!(db.restore_history(false, &root.join("papers")).is_err());
    assert_eq!(state(&db), history);
    assert_eq!(
        serde_json::to_string(&db.vocabulary("", None).unwrap()).unwrap(),
        before
    );
    db.record("논문 삭제", LIBRARY, |db| db.delete_library_paper(&id))
        .unwrap();
    fs::remove_file(root.join("papers").join(format!("{id}.pdf"))).unwrap();
    let history = state(&db);
    assert!(db.restore_history(false, &root.join("papers")).is_err());
    assert_eq!(state(&db), history);
    assert!(db.library().unwrap().papers.is_empty());
    fk(root);
}
#[test]
fn new_changes_clear_redo_noops_and_failures_do_not_and_history_is_bounded() {
    let (dir, mut db, id) = fixture();
    let root = dir.path();
    db.record("메모", LIBRARY, |db| db.set_paper_memo(&id, "one"))
        .unwrap();
    db.restore_history(false, &root.join("papers")).unwrap();
    db.record("무변경", LIBRARY, |db| db.set_paper_memo(&id, ""))
        .unwrap();
    assert!(db.history_state().redo.is_some());
    assert!(db
        .record("실패", LIBRARY, |db| db.rename_library_paper(&id, ""))
        .is_err());
    assert!(db.history_state().redo.is_some());
    for i in 0..55 {
        db.record("메모", LIBRARY, |db| {
            db.set_paper_memo(&id, &format!("memo {i}"))
        })
        .unwrap();
    }
    assert!(db.history_state().redo.is_none());
    for _ in 0..50 {
        assert!(db
            .restore_history(false, &root.join("papers"))
            .unwrap()
            .is_some());
    }
    assert_eq!(
        db.restore_history(false, &root.join("papers")).unwrap(),
        None
    );
    assert_eq!(db.library().unwrap().papers[0].memo, "memo 4");
}
#[test]
fn undo_updates_only_changed_fields_and_preserves_unrelated_later_data() {
    let (dir, mut db, id) = fixture();
    db.record("메모", LIBRARY, |db| db.set_paper_memo(&id, "memo"))
        .unwrap();
    db.rename_library_paper(&id, "Later title").unwrap();
    db.set_initial_credit("9").unwrap();
    db.save_lookup(&request(&id), "할당").unwrap();
    db.restore_history(false, &dir.path().join("papers"))
        .unwrap();
    let library = db.library().unwrap();
    assert_eq!(library.papers[0].paper.title, "Later title");
    assert!(library.papers[0].memo.is_empty());
    assert_eq!(db.vocabulary("", None).unwrap().len(), 1);
    assert_eq!(db.usage_summary().unwrap().initial_credit_usd, Some(9.));
}

#[test]
fn new_lookups_do_not_reuse_deleted_ids_reserved_for_undo() {
    let (dir, mut db, id) = fixture();
    let old = db.save_lookup(&request(&id), "할당").unwrap();
    db.record("삭제", VOCABULARY, |db| {
        db.delete_vocabulary(&[old.vocabulary_entry_id])
    })
    .unwrap();
    let mut new = request(&id);
    new.word = "another".into();
    new.position.rects[0][0] = 2.;
    let added = db.save_lookup(&new, "다른").unwrap();
    assert_ne!(added.vocabulary_entry_id, old.vocabulary_entry_id);
    assert_ne!(added.id, old.id);
    db.restore_history(false, &dir.path().join("papers"))
        .unwrap();
    assert_eq!(db.vocabulary("", None).unwrap().len(), 2);
    assert_eq!(db.highlights(&id).unwrap().len(), 2);
    fk(dir.path());
    db.restore_history(true, &dir.path().join("papers"))
        .unwrap();
    assert_eq!(db.vocabulary("", None).unwrap()[0].word, "another");
    assert_eq!(db.highlights(&id).unwrap()[0].id, added.id);
}
