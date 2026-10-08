use paper_vocabulary_lib::{
    connection::AiProvider,
    db::Database,
    lookup,
    models::{ActionType, LookupRequest, Paper, PositionData, TextLookupRequest},
    usage::{AiResult, TokenUsage},
};
use std::{path::Path, sync::Mutex};
fn request() -> LookupRequest {
    LookupRequest {
        paper_id: "paper".into(),
        page_number: 1,
        word: "asymptotic".into(),
        original_sentence: "An asymptotic method works.".into(),
        action: ActionType::Explanation,
        color: Default::default(),
        position: PositionData {
            version: 1,
            rects: vec![[10., 20., 60., 32.]],
            start_offset: 3,
            end_offset: 13,
        },
    }
}
fn response(id: &str) -> AiResult {
    AiResult {
        provider: AiProvider::Api,
        text: "문맥에 따른 설명입니다.".into(),
        response_id: Some(id.into()),
        usage: TokenUsage {
            input: 100,
            output: 30,
            cached_input: 0,
            cache_write: 0,
            estimated: false,
        },
    }
}
fn open(path: &Path) -> Mutex<Database> {
    let db = Database::open(path).unwrap();
    db.register_paper(
        &Paper {
            id: "paper".into(),
            title: "Paper".into(),
            file_name: "paper.pdf".into(),
        },
        Path::new("paper.pdf"),
    )
    .unwrap();
    db.set_initial_credit("5").unwrap();
    Mutex::new(db)
}
#[tokio::test]
async fn word_and_phrase_explanations_cache_without_saving_and_translation_still_saves() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let db = open(&path);
    let word = request();
    let phrase = TextLookupRequest {
        paper_id: "paper".into(),
        page_number: 1,
        selected_text: "asymptotic method".into(),
        context: word.original_sentence.clone(),
        action: ActionType::Explanation,
    };
    assert!(
        lookup::lookup_word(&db, &word, || async { Ok(response("word")) })
            .await
            .unwrap()
            .highlight
            .is_none()
    );
    assert!(
        lookup::lookup_text(&db, &phrase, || async { Ok(response("phrase")) })
            .await
            .unwrap()
            .highlight
            .is_none()
    );
    assert!(db.lock().unwrap().vocabulary("", None).unwrap().is_empty());
    assert!(db.lock().unwrap().highlights("paper").unwrap().is_empty());
    let cost = db.lock().unwrap().usage_summary().unwrap().total_cost_usd;
    assert!(cost > 0.);
    drop(db);
    let db = open(&path);
    db.lock()
        .unwrap()
        .set_ai_provider(AiProvider::Chatgpt)
        .unwrap();
    lookup::lookup_word(&db, &word, || async { panic!("cached word") })
        .await
        .unwrap();
    lookup::lookup_text(&db, &phrase, || async { panic!("cached phrase") })
        .await
        .unwrap();
    assert_eq!(
        db.lock().unwrap().usage_summary().unwrap().total_cost_usd,
        cost
    );
    let mut translated = word.clone();
    translated.action = ActionType::Translation;
    assert!(
        lookup::lookup_word(&db, &translated, || async { Ok(response("translation")) })
            .await
            .unwrap()
            .highlight
            .is_some()
    );
    let before = serde_json::to_string(&db.lock().unwrap().vocabulary("", None).unwrap()).unwrap();
    lookup::lookup_word(&db, &word, || async { panic!("cached") })
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_string(&db.lock().unwrap().vocabulary("", None).unwrap()).unwrap(),
        before
    );
    assert_eq!(db.lock().unwrap().highlights("paper").unwrap().len(), 1);
    let highlight = db.lock().unwrap().highlights("paper").unwrap().remove(0);
    assert_eq!(
        db.lock()
            .unwrap()
            .saved_highlight("paper", highlight.id)
            .unwrap()
            .explanation,
        Some("문맥에 따른 설명입니다.".into())
    );
    let mut translated_phrase = phrase;
    translated_phrase.action = ActionType::Translation;
    lookup::lookup_text(&db, &translated_phrase, || async {
        Ok(response("translated phrase"))
    })
    .await
    .unwrap();
    assert_eq!(db.lock().unwrap().vocabulary("", None).unwrap().len(), 2);
}
#[tokio::test]
async fn failed_explanations_do_not_charge_or_cache_and_cache_write_failure_rolls_back_usage() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let db = open(&path);
    assert!(
        lookup::lookup_word(&db, &request(), || async { Err("offline".into()) })
            .await
            .is_err()
    );
    let mut empty = response("empty");
    empty.text.clear();
    assert!(lookup::lookup_word(&db, &request(), || async { Ok(empty) })
        .await
        .is_err());
    let sql = rusqlite::Connection::open(&path).unwrap();
    sql.execute_batch("CREATE TRIGGER fail_explanation BEFORE INSERT ON explanation_cache BEGIN SELECT RAISE(ABORT, 'test'); END;").unwrap();
    assert!(
        lookup::lookup_word(&db, &request(), || async { Ok(response("rollback")) })
            .await
            .is_err()
    );
    assert_eq!(
        db.lock().unwrap().usage_summary().unwrap().total_cost_usd,
        0.
    );
    assert!(db.lock().unwrap().vocabulary("", None).unwrap().is_empty());
    sql.execute_batch("DROP TRIGGER fail_explanation;").unwrap();
    lookup::lookup_word(&db, &request(), || async { Ok(response("retry")) })
        .await
        .unwrap();
}
#[tokio::test]
async fn legacy_saved_explanation_is_reused_without_modifying_old_vocabulary_or_highlight() {
    let db = open(Path::new(":memory:"));
    db.lock()
        .unwrap()
        .complete_lookup(Some(&request()), response("legacy"))
        .unwrap();
    let before = serde_json::to_string(&db.lock().unwrap().vocabulary("", None).unwrap()).unwrap();
    let highlights =
        serde_json::to_string(&db.lock().unwrap().highlights("paper").unwrap()).unwrap();
    let cost = db.lock().unwrap().usage_summary().unwrap().total_cost_usd;
    assert!(
        lookup::lookup_word(&db, &request(), || async { panic!("legacy cache") })
            .await
            .unwrap()
            .highlight
            .is_none()
    );
    assert_eq!(
        serde_json::to_string(&db.lock().unwrap().vocabulary("", None).unwrap()).unwrap(),
        before
    );
    assert_eq!(
        serde_json::to_string(&db.lock().unwrap().highlights("paper").unwrap()).unwrap(),
        highlights
    );
    assert_eq!(
        db.lock().unwrap().usage_summary().unwrap().total_cost_usd,
        cost
    );
}
