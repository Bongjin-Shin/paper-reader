use paper_vocabulary_lib::{
    db::Database,
    lookup::lookup_word,
    models::{ActionType, LookupRequest, Paper, PositionData},
    usage::{AiResult, TokenUsage},
};
use rusqlite::Connection;
use std::{
    path::Path,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    },
};

fn register(db: &Database, id: &str) {
    db.register_paper(
        &Paper {
            id: id.into(),
            title: format!("논문 {id}"),
            file_name: format!("{id}.pdf"),
        },
        Path::new("test.pdf"),
    )
    .unwrap();
}
fn request(paper: &str, word: &str, context: &str, action: ActionType) -> LookupRequest {
    LookupRequest {
        paper_id: paper.into(),
        page_number: 3,
        word: word.into(),
        original_sentence: context.into(),
        action,
        color: Default::default(),
        position: PositionData {
            version: 1,
            rects: vec![[10., 20., 90., 34.]],
            start_offset: 2,
            end_offset: 18,
        },
    }
}
fn response(text: &str, id: &str) -> AiResult {
    AiResult {
        provider: paper_vocabulary_lib::connection::AiProvider::Api,
        text: text.into(),
        response_id: Some(id.into()),
        usage: TokenUsage {
            input: 1000,
            cached_input: 0,
            cache_write: 0,
            output: 100,
            estimated: false,
        },
    }
}

#[tokio::test]
async fn cache_reuses_exact_context_action_across_papers_and_restart_without_api_or_cost() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let db = Database::open(&path).unwrap();
    register(&db, "a");
    register(&db, "b");
    db.set_initial_credit("5").unwrap();
    let db = Mutex::new(db);
    let calls = AtomicUsize::new(0);
    let first = request(
        "a",
        "Decision-making",
        "A decision-making model.",
        ActionType::Translation,
    );
    let saved = lookup_word(&db, &first, || async {
        calls.fetch_add(1, Ordering::SeqCst);
        Ok(response("의사 결정", "first"))
    })
    .await
    .unwrap();
    let cost = db.lock().unwrap().usage_summary().unwrap().total_cost_usd;
    drop(db);
    let db = Mutex::new(Database::open(&path).unwrap());
    let mut second = first.clone();
    second.paper_id = "b".into();
    second.word = "decision-making".into();
    second.page_number = 8;
    let cached = lookup_word(&db, &second, || async {
        panic!("A cache hit must not validate an API key or send a request")
    })
    .await
    .unwrap();
    assert_eq!(cached.text, "의사 결정");
    assert_eq!(cached.highlight.as_ref().unwrap().page_number, 8);
    assert_ne!(cached.highlight.unwrap().id, saved.highlight.unwrap().id);
    // Repeating the same occurrence increments the lookup count but not highlight count.
    lookup_word(&db, &second, || async { panic!("No network") })
        .await
        .unwrap();
    let db = db.lock().unwrap();
    let entries = db.vocabulary("", None).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].lookup_count, 3);
    assert_eq!(entries[0].contexts.len(), 2);
    assert_eq!(db.highlights("b").unwrap().len(), 1);
    assert_eq!(db.usage_summary().unwrap().total_cost_usd, cost);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn context_action_and_word_are_distinct_cache_keys_and_failures_do_not_count() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let db = Database::open(&path).unwrap();
    register(&db, "a");
    let db = Mutex::new(db);
    let first = request(
        "a",
        "allocation",
        "Task allocation.",
        ActionType::Translation,
    );
    lookup_word(&db, &first, || async { Ok(response("할당", "1")) })
        .await
        .unwrap();
    let calls = AtomicUsize::new(0);
    let mut variants = vec![first.clone(); 4];
    variants[0].action = ActionType::Explanation;
    variants[1].original_sentence = "Memory allocation.".into();
    variants[2].word = "Task".into();
    variants[3].original_sentence.push(' '); // Context is exact, not silently rewritten.
    for (i, variant) in variants.iter().enumerate() {
        lookup_word(&db, variant, || async {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(response("별도 결과", &format!("v{i}")))
        })
        .await
        .unwrap();
    }
    assert_eq!(calls.load(Ordering::SeqCst), 4);
    let count = db.lock().unwrap().vocabulary("allocation", None).unwrap()[0].lookup_count;
    let cost = db.lock().unwrap().usage_summary().unwrap().total_cost_usd;
    let failed = request(
        "a",
        "allocation",
        "An unseen allocation.",
        ActionType::Explanation,
    );
    assert!(
        lookup_word(&db, &failed, || async { Err("network failed".into()) })
            .await
            .is_err()
    );
    assert!(
        lookup_word(&db, &failed, || async { Ok(response("  ", "empty")) })
            .await
            .is_err()
    );
    assert_eq!(
        db.lock().unwrap().vocabulary("allocation", None).unwrap()[0].lookup_count,
        count
    );
    assert_eq!(
        db.lock().unwrap().usage_summary().unwrap().total_cost_usd,
        cost
    );
    let mut invalid = first.clone();
    invalid.paper_id = "missing".into();
    assert!(lookup_word(&db, &invalid, || async {
        panic!("Invalid paper must not call API")
    })
    .await
    .is_err());
}

#[test]
fn vocabulary_groups_contexts_searches_all_meanings_and_filters_using_saved_papers() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Database::open(&dir.path().join("data.db")).unwrap();
    for id in ["a", "b", "empty"] {
        register(&db, id);
    }
    let a = request(
        "a",
        "Allocation",
        "Task allocation.",
        ActionType::Translation,
    );
    db.save_lookup(&a, "작업 배분").unwrap();
    let mut explanation = a.clone();
    explanation.action = ActionType::Explanation;
    db.save_lookup(&explanation, "임무를 나눕니다.").unwrap();
    let mut b = request(
        "b",
        "allocation",
        "Memory allocation.",
        ActionType::Translation,
    );
    b.page_number = 7;
    db.save_lookup(&b, "메모리 할당").unwrap();
    db.save_lookup(&b, "메모리 할당").unwrap();
    let entries = db.vocabulary("  ALLOC  ", None).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].lookup_count, 4);
    assert_eq!(entries[0].contexts.len(), 2);
    assert_eq!(
        entries[0].contexts[0].translation.as_deref(),
        Some("작업 배분")
    );
    assert_eq!(
        entries[0].contexts[0].explanation.as_deref(),
        Some("임무를 나눕니다.")
    );
    assert_eq!(entries[0].contexts[1].paper_title, "논문 b");
    assert_eq!(entries[0].contexts[1].page_number, 7);
    assert_eq!(db.vocabulary("배분", None).unwrap().len(), 1); // Earlier context meaning is searchable.
    let filtered = db.vocabulary("배분", Some("a")).unwrap();
    assert_eq!(filtered[0].contexts.len(), 1);
    assert_eq!(filtered[0].translation.as_deref(), Some("작업 배분"));
    assert_eq!(filtered[0].lookup_count, 4); // Entry-wide count stays consistent under filters.
    assert!(db.vocabulary("배분", Some("b")).unwrap().is_empty());
    for query in ["임무", "%", "_", "' OR 1=1 --"] {
        assert!(db.vocabulary(query, None).unwrap().is_empty());
    }
    assert_eq!(db.papers().unwrap().len(), 3);
    assert!(db.vocabulary("", Some("empty")).unwrap().is_empty());
    assert!(db.vocabulary("", Some("missing")).unwrap().is_empty());
}

#[test]
fn saved_highlight_uses_its_own_context_and_never_changes_lookup_count_or_usage() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let mut db = Database::open(&path).unwrap();
    register(&db, "a");
    register(&db, "b");
    let a = request(
        "a",
        "allocation",
        "Task allocation.",
        ActionType::Translation,
    );
    let h = db.save_lookup(&a, "작업 배분").unwrap();
    let mut explanation = a.clone();
    explanation.action = ActionType::Explanation;
    db.save_lookup(&explanation, "임무를 나눕니다.").unwrap();
    let b = request(
        "b",
        "allocation",
        "Memory allocation.",
        ActionType::Translation,
    );
    db.save_lookup(&b, "메모리 할당").unwrap();
    drop(db);
    let db = Database::open(&path).unwrap();
    for _ in 0..3 {
        let result = db.saved_highlight("a", h.id).unwrap();
        assert_eq!(result.text, "임무를 나눕니다.");
        assert_eq!(result.action.as_str(), "explanation");
        assert_eq!(result.original_sentence, "Task allocation.");
        assert_eq!(result.translation.as_deref(), Some("작업 배분"));
        assert_eq!(result.explanation.as_deref(), Some("임무를 나눕니다."));
    }
    assert!(db.saved_highlight("b", h.id).is_err());
    assert!(db.saved_highlight("a", 999).is_err());
    assert_eq!(db.vocabulary("", None).unwrap()[0].lookup_count, 3);
    assert_eq!(db.usage_summary().unwrap().total_cost_usd, 0.);
}

#[test]
fn migration_backfills_counts_and_cache_without_losing_v2_data_or_recounting_on_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("v2.db");
    let connection = Connection::open(&path).unwrap();
    connection
        .execute_batch(include_str!("../migrations/001_initial.sql"))
        .unwrap();
    connection
        .execute_batch(include_str!("../migrations/002_api_usage.sql"))
        .unwrap();
    connection.execute_batch("INSERT INTO papers(id,file_name,file_path,title) VALUES ('a','a.pdf','a.pdf','Old paper');
      INSERT INTO vocabulary_entries(id,word,translation) VALUES (1,'allocation','할당');
      INSERT INTO vocabulary_contexts(vocabulary_entry_id,paper_id,page_number,original_sentence,action_type,result)
      VALUES (1,'a',3,'Task allocation.','translation','할당'), (1,'a',3,'Task allocation.','explanation','나눕니다.');
      INSERT INTO highlights(paper_id,vocabulary_entry_id,context_id,page_number,selected_text,position_data)
      VALUES ('a',1,1,3,'allocation','{\"version\":1,\"rects\":[[10.0,20.0,90.0,34.0]],\"startOffset\":2,\"endOffset\":18}');
      UPDATE api_credit SET initial_nano_usd = 5000000000;").unwrap();
    drop(connection);
    let mut db = Database::open(&path).unwrap();
    assert_eq!(db.vocabulary("", None).unwrap()[0].lookup_count, 2);
    let cached = db
        .reuse_lookup(&request(
            "a",
            "allocation",
            "Task allocation.",
            ActionType::Translation,
        ))
        .unwrap()
        .unwrap();
    assert_eq!(cached.text, "할당");
    assert_eq!(db.highlights("a").unwrap().len(), 1);
    drop(db);
    let db = Database::open(&path).unwrap();
    assert_eq!(db.vocabulary("", None).unwrap()[0].lookup_count, 3);
    assert_eq!(db.vocabulary("", None).unwrap()[0].contexts.len(), 1);
    assert_eq!(db.usage_summary().unwrap().estimated_balance_usd, Some(5.));
    assert_eq!(db.papers().unwrap()[0].title, "Old paper");
}

#[test]
fn failed_cached_save_rolls_back_count_and_context_and_keeps_the_cached_result() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let mut db = Database::open(&path).unwrap();
    register(&db, "a");
    let request = request(
        "a",
        "author’s",
        "The author’s model.",
        ActionType::Translation,
    );
    db.save_lookup(&request, "저자의").unwrap();
    let connection = Connection::open(&path).unwrap();
    connection.execute_batch("CREATE TRIGGER prevent_highlight BEFORE INSERT ON highlights BEGIN SELECT RAISE(ABORT, 'test write failure'); END;").unwrap();
    assert!(db.reuse_lookup(&request).is_err());
    assert_eq!(db.vocabulary("author's", None).unwrap()[0].lookup_count, 1);
    assert_eq!(
        connection
            .query_row::<i64, _, _>("SELECT count(*) FROM vocabulary_contexts", [], |r| r.get(0))
            .unwrap(),
        1
    );
    connection
        .execute_batch("DROP TRIGGER prevent_highlight;")
        .unwrap();
    let mut normalized = request.clone();
    normalized.word = "author's".into();
    assert_eq!(
        db.reuse_lookup(&normalized).unwrap().unwrap().text,
        "저자의"
    );
}
