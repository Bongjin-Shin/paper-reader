use paper_vocabulary_lib::{
    db::Database,
    lookup::lookup_text,
    models::{ActionType, HighlightColor, LookupRequest, Paper, PositionData, TextLookupRequest},
    usage::{AiResult, TokenUsage},
};
use rusqlite::Connection;
use std::{path::Path, sync::Mutex};

fn register(db: &Database, paper: &str) {
    db.register_paper(
        &Paper {
            id: paper.into(),
            file_name: format!("{paper}.pdf"),
            title: paper.into(),
        },
        Path::new("test.pdf"),
    )
    .unwrap();
}
fn word(color: HighlightColor) -> LookupRequest {
    LookupRequest {
        paper_id: "paper".into(),
        page_number: 2,
        word: "allocation".into(),
        original_sentence: "Memory allocation.".into(),
        action: ActionType::Translation,
        color,
        position: PositionData {
            version: 1,
            start_offset: 7,
            end_offset: 17,
            rects: vec![[20., 30., 90., 45.]],
        },
    }
}
fn phrase() -> TextLookupRequest {
    TextLookupRequest {
        paper_id: "paper".into(),
        page_number: 2,
        selected_text: "The selected\nsentence stays complete.".into(),
        context: "Before. The selected sentence stays complete. After.".into(),
        action: ActionType::Translation,
    }
}

#[tokio::test]
async fn phrase_saves_exact_text_and_context_reuses_cache_and_survives_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let db = Database::open(&path).unwrap();
    register(&db, "paper");
    register(&db, "other");
    db.set_initial_credit("5").unwrap();
    let db = Mutex::new(db);
    let mut request = phrase();
    lookup_text(&db, &request, || async {
        Ok(AiResult {
            provider: paper_vocabulary_lib::connection::AiProvider::Api,
            text: "선택한 문장 전체가 유지됩니다.".into(),
            response_id: Some("phrase".into()),
            usage: TokenUsage {
                input: 100,
                cached_input: 0,
                cache_write: 0,
                output: 20,
                estimated: false,
            },
        })
    })
    .await
    .unwrap();
    let cost = db.lock().unwrap().usage_summary().unwrap().total_cost_usd;
    drop(db);
    let db = Mutex::new(Database::open(&path).unwrap());
    request.paper_id = "other".into();
    lookup_text(&db, &request, || async {
        panic!("Cached phrase must not call the API")
    })
    .await
    .unwrap();
    let stored = db.lock().unwrap().vocabulary("SELECTED", None).unwrap();
    assert_eq!(stored[0].word, request.selected_text);
    assert_eq!(stored[0].contexts.len(), 2);
    assert_eq!(stored[0].lookup_count, 2);
    assert_eq!(stored[0].contexts[0].original_sentence, request.context);
    assert_eq!(
        db.lock().unwrap().usage_summary().unwrap().total_cost_usd,
        cost
    );
    request.action = ActionType::Explanation;
    assert!(
        lookup_text(&db, &request, || async { Err("API failed".into()) })
            .await
            .is_err()
    );
    assert_eq!(
        db.lock().unwrap().vocabulary("", None).unwrap()[0].lookup_count,
        2
    );
    assert!(db.lock().unwrap().highlights("paper").unwrap().is_empty());
}

#[test]
fn highlight_color_and_removal_persist_without_deleting_vocabulary_or_cache() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let mut db = Database::open(&path).unwrap();
    register(&db, "paper");
    register(&db, "other");
    for color in [
        HighlightColor::Yellow,
        HighlightColor::Green,
        HighlightColor::Blue,
        HighlightColor::Pink,
        HighlightColor::Purple,
    ] {
        db.set_highlight_color(color).unwrap();
        assert_eq!(db.highlight_color().unwrap(), color);
    }
    let mut request = word(HighlightColor::Blue);
    let h = db.save_lookup(&request, "할당").unwrap();
    assert_eq!(h.color, HighlightColor::Blue);
    request.color = HighlightColor::Pink;
    assert_eq!(
        db.reuse_lookup(&request)
            .unwrap()
            .unwrap()
            .highlight
            .unwrap()
            .color,
        HighlightColor::Blue
    );
    assert!(db.remove_highlights("other", &[h.id]).unwrap().is_empty());
    assert_eq!(db.remove_highlights("paper", &[h.id]).unwrap(), vec![h.id]);
    assert_eq!(db.vocabulary("", None).unwrap()[0].lookup_count, 2);
    drop(db);
    let mut db = Database::open(&path).unwrap();
    assert_eq!(db.highlight_color().unwrap(), HighlightColor::Purple);
    assert!(db.highlights("paper").unwrap().is_empty());
    let restored = db.reuse_lookup(&request).unwrap().unwrap();
    assert_eq!(restored.text, "할당");
    assert_eq!(restored.highlight.unwrap().color, HighlightColor::Pink);
    assert_eq!(db.usage_summary().unwrap().total_cost_usd, 0.0);
}

#[test]
fn version_three_migration_keeps_existing_data_and_assigns_yellow() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let old = Connection::open(&path).unwrap();
    old.execute_batch(concat!(
        include_str!("../migrations/001_initial.sql"),
        include_str!("../migrations/002_api_usage.sql"),
        include_str!("../migrations/003_vocabulary.sql")
    ))
    .unwrap();
    old.execute_batch("INSERT INTO papers(id,file_name,file_path,title) VALUES('paper','p.pdf','p.pdf','Paper');
        INSERT INTO vocabulary_entries(id,word,translation,lookup_count) VALUES(1,'allocation','할당',7);
        INSERT INTO vocabulary_contexts(id,vocabulary_entry_id,paper_id,page_number,original_sentence,action_type,result) VALUES(1,1,'paper',2,'Memory allocation.','translation','할당');
        INSERT INTO highlights(paper_id,vocabulary_entry_id,context_id,page_number,selected_text,position_data) VALUES('paper',1,1,2,'allocation','{\"version\":1,\"startOffset\":7,\"endOffset\":17,\"rects\":[[20,30,90,45]]}');
        UPDATE api_credit SET initial_nano_usd=5000000000;").unwrap();
    drop(old);
    let db = Database::open(&path).unwrap();
    assert_eq!(
        db.highlights("paper").unwrap()[0].color,
        HighlightColor::Yellow
    );
    assert_eq!(db.vocabulary("", None).unwrap()[0].lookup_count, 7);
    assert_eq!(db.usage_summary().unwrap().estimated_balance_usd, Some(5.0));
    drop(db);
    assert_eq!(
        Database::open(&path).unwrap().vocabulary("", None).unwrap()[0].lookup_count,
        7
    );
    assert!(serde_json::from_str::<HighlightColor>("\"red\"").is_err());
}

#[test]
fn phrase_failed_transaction_and_empty_result_do_not_create_entries() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let mut db = Database::open(&path).unwrap();
    register(&db, "paper");
    assert!(db.save_text_lookup(&phrase(), " ").is_err());
    let connection = Connection::open(path).unwrap();
    connection.execute_batch("CREATE TRIGGER fail_context BEFORE INSERT ON vocabulary_contexts BEGIN SELECT RAISE(FAIL,'test'); END;").unwrap();
    assert!(db.save_text_lookup(&phrase(), "선택한 문장").is_err());
    assert!(db.vocabulary("", None).unwrap().is_empty());
    assert_eq!(
        connection
            .query_row::<i64, _, _>("SELECT count(*) FROM vocabulary_entries", [], |r| r.get(0))
            .unwrap(),
        0
    );
}

#[test]
fn vocabulary_deletion_removes_all_contexts_cache_and_highlights_but_keeps_papers_and_costs() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let pdf_path = dir.path().join("paper.pdf");
    std::fs::write(&pdf_path, b"%PDF-test original").unwrap();
    let mut db = Database::open(&path).unwrap();
    for id in ["paper", "other"] {
        db.register_paper(
            &Paper {
                id: id.into(),
                title: id.into(),
                file_name: format!("{id}.pdf"),
            },
            &pdf_path,
        )
        .unwrap();
    }
    db.set_initial_credit("5").unwrap();
    db.set_highlight_color(HighlightColor::Pink).unwrap();
    let mut request = word(HighlightColor::Blue);
    let h = db
        .complete_lookup(
            Some(&request),
            AiResult {
                provider: paper_vocabulary_lib::connection::AiProvider::Api,
                text: "할당".into(),
                response_id: Some("deletion-test".into()),
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
    request.action = ActionType::Explanation;
    db.save_lookup(&request, "메모리를 할당합니다.").unwrap();
    request.paper_id = "other".into();
    db.save_lookup(&request, "다른 논문의 문맥").unwrap();
    db.save_text_lookup(&phrase(), "선택한 전체 문장").unwrap();
    let phrase_id = db.vocabulary("selected", None).unwrap()[0].id;
    let mut kept = word(HighlightColor::Green);
    kept.word = "memory".into();
    kept.original_sentence = "Memory is available.".into();
    kept.position.start_offset = 0;
    kept.position.end_offset = 6;
    let kept_highlight = db.save_lookup(&kept, "메모리").unwrap();
    let before = db.usage_summary().unwrap();
    assert!(before.total_cost_usd > 0.0);
    assert!(db.delete_vocabulary(&[h.vocabulary_entry_id, -1]).is_err());
    assert_eq!(db.vocabulary("", None).unwrap().len(), 3);
    assert_eq!(
        db.delete_vocabulary(&[
            h.vocabulary_entry_id,
            phrase_id,
            h.vocabulary_entry_id,
            i64::MAX
        ])
        .unwrap(),
        vec![h.vocabulary_entry_id, phrase_id]
    );
    assert!(db.delete_vocabulary(&[]).unwrap().is_empty());
    drop(db);

    let mut db = Database::open(&path).unwrap();
    let entries = db.vocabulary("", None).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].word, "memory");
    assert_eq!(entries[0].lookup_count, 1);
    assert_eq!(db.highlights("paper").unwrap()[0].id, kept_highlight.id);
    assert_eq!(db.highlights("paper").unwrap().len(), 1);
    assert!(db.highlights("other").unwrap().is_empty());
    assert!(db.saved_highlight("paper", h.id).is_err());
    assert!(db.reuse_lookup(&request).unwrap().is_none());
    request.action = ActionType::Translation;
    assert!(db.reuse_lookup(&request).unwrap().is_none());
    assert!(db.reuse_text_lookup(&phrase()).unwrap().is_none());
    assert_eq!(db.reuse_lookup(&kept).unwrap().unwrap().text, "메모리");
    assert_eq!(db.papers().unwrap().len(), 2);
    assert_eq!(
        std::fs::read(db.paper_path("paper").unwrap()).unwrap(),
        b"%PDF-test original"
    );
    assert_eq!(db.highlight_color().unwrap(), HighlightColor::Pink);
    let after = db.usage_summary().unwrap();
    assert_eq!(after.total_cost_usd, before.total_cost_usd);
    assert_eq!(after.estimated_balance_usd, before.estimated_balance_usd);
    let connection = Connection::open(path).unwrap();
    assert_eq!(
        connection
            .query_row::<i64, _, _>("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
                .get(0))
            .unwrap(),
        0
    );
}

#[test]
fn vocabulary_batch_deletion_rolls_back_every_entry_on_failure() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let mut db = Database::open(&path).unwrap();
    register(&db, "paper");
    let first = db.save_lookup(&word(HighlightColor::Blue), "할당").unwrap();
    db.save_text_lookup(&phrase(), "선택 문장").unwrap();
    let second = db.vocabulary("selected", None).unwrap()[0].id;
    let connection = Connection::open(path).unwrap();
    connection.execute_batch(&format!("CREATE TRIGGER fail_delete BEFORE DELETE ON vocabulary_entries WHEN OLD.id = {second} BEGIN SELECT RAISE(FAIL, 'test'); END;")).unwrap();
    assert!(db
        .delete_vocabulary(&[first.vocabulary_entry_id, second])
        .is_err());
    assert_eq!(db.vocabulary("", None).unwrap().len(), 2);
    assert_eq!(db.highlights("paper").unwrap().len(), 1);
    assert_eq!(db.saved_highlight("paper", first.id).unwrap().text, "할당");
    assert_eq!(
        db.vocabulary("selected", None).unwrap()[0].contexts[0]
            .translation
            .as_deref(),
        Some("선택 문장")
    );
    connection
        .execute_batch("DROP TRIGGER fail_delete")
        .unwrap();
    assert_eq!(
        db.delete_vocabulary(&[first.vocabulary_entry_id, second])
            .unwrap()
            .len(),
        2
    );
    assert!(db.vocabulary("", None).unwrap().is_empty());
    assert!(db.highlights("paper").unwrap().is_empty());
}
