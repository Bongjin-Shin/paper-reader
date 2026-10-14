use paper_vocabulary_lib::{
    chat::{ChatEdit, ChatRequest},
    chat_memory::{bounded_text, history_input, summary_work},
    db::Database,
    models::Paper,
};
use serde_json::{json, Value};
use std::path::Path;

fn request(paper: &str, question: &str) -> ChatRequest {
    ChatRequest {
        paper_id: paper.into(),
        question: question.into(),
        context: "[p. 4] Original equation and definition".into(),
        current_page: 4,
        total_pages: 8,
    }
}
fn register(db: &Database, id: &str) {
    db.register_paper(
        &Paper {
            id: id.into(),
            title: id.into(),
            file_name: format!("{id}.pdf"),
        },
        Path::new("a.pdf"),
    )
    .unwrap();
}

#[test]
fn summaries_are_incremental_persistent_and_keep_verified_corrections_and_recent_verbatim() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db.sqlite");
    let db = Database::open(&path).unwrap();
    register(&db, "a");
    for i in 0..13 {
        db.save_chat(
            &request("a", &format!("질문 {i}: r20이 아니라 r^s를 뜻해")),
            &format!("답변 {i}"),
            "model",
            "high",
        )
        .unwrap();
    }
    let history = db.paper_chat("a").unwrap();
    let work = summary_work(&history, None).unwrap();
    assert_eq!(work.rows.len(), 5);
    let payload = work.payload("chosen");
    assert_eq!(payload["model"], "chosen");
    assert!(payload["text"]["format"]["schema"].is_object());
    let memory = work.accept(&json!({"summary":"r^s에 대한 설명. 수식 원문은 4페이지에서 확인.","important_user_notes":[
        {"exchange_id":history[0].id,"quote":"r20이 아니라 r^s를 뜻해"},
        {"exchange_id":history[1].id,"quote":"모델이 지어낸 정정"}
    ]}).to_string()).unwrap();
    assert_eq!(memory.important_user_notes.len(), 1);
    db.save_chat_memory("a", &memory).unwrap();
    drop(db);
    let db = Database::open(&path).unwrap();
    let loaded = db.chat_memory("a", &history).unwrap().unwrap();
    assert_eq!(loaded.through_exchange_id, history[4].id);
    assert!(summary_work(&history, Some(&loaded)).is_none());
    let req = request("a", "다시 설명해줘");
    let plan = db.prepare_chat(&req, None).unwrap();
    let payload = plan.payload_with_memory(&req, "model", "high", Some(&loaded));
    let input: Value = serde_json::from_str(payload["input"].as_str().unwrap()).unwrap();
    assert_eq!(input["previous_conversation"].as_array().unwrap().len(), 8);
    assert_eq!(input["previous_conversation"][0]["answer"], "답변 5");
    assert_eq!(
        input["older_conversation_memory"]["important_user_notes"][0]["quote"],
        "r20이 아니라 r^s를 뜻해"
    );
    assert_eq!(input["paper_excerpts"], req.context);
    assert_eq!(db.paper_chat("a").unwrap().len(), 13);
    for i in 13..18 {
        db.save_chat(
            &request("a", &format!("후속 질문 {i}")),
            "추가 답변",
            "model",
            "high",
        )
        .unwrap();
    }
    let history = db.paper_chat("a").unwrap();
    let next = summary_work(&history, Some(&loaded)).unwrap();
    assert_eq!(next.rows[0].id, history[5].id);
    let updated = next
        .accept(r#"{"summary":"갱신된 요약","important_user_notes":[]}"#)
        .unwrap();
    assert_eq!(updated.important_user_notes.len(), 1); // Exact prior corrections survive another compaction.
}

#[test]
fn edited_or_other_paper_branches_cannot_inherit_future_summaries() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("db")).unwrap();
    register(&db, "a");
    register(&db, "b");
    for i in 0..13 {
        db.save_chat(&request("a", &format!("Q{i}")), "original", "model", "")
            .unwrap();
    }
    let original = db.paper_chat("a").unwrap();
    let memory = summary_work(&original, None)
        .unwrap()
        .accept(r#"{"summary":"Old branch only","important_user_notes":[]}"#)
        .unwrap();
    db.save_chat_memory("a", &memory).unwrap();
    let req = request("a", "Edited Q2");
    let plan = db
        .prepare_chat(
            &req,
            Some(&ChatEdit {
                exchange_id: original[2].id,
                followup_index: None,
            }),
        )
        .unwrap();
    assert!(db.chat_memory("a", &plan.history).unwrap().is_none());
    let input: Value = serde_json::from_str(
        plan.payload_with_memory(&req, "model", "", Some(&memory))["input"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    assert!(input["older_conversation_memory"].is_null());
    assert!(!input.to_string().contains("Old branch only"));
    assert!(db.chat_memory("b", &original).unwrap().is_none());
    let late_plan = db
        .prepare_chat(
            &req,
            Some(&ChatEdit {
                exchange_id: original[9].id,
                followup_index: None,
            }),
        )
        .unwrap();
    assert!(db.chat_memory("a", &late_plan.history).unwrap().is_some()); // Common ancestor is reusable.
}

#[test]
fn invalid_summary_falls_back_to_bounded_recent_context_without_changing_originals() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("db")).unwrap();
    register(&db, "a");
    for i in 0..15 {
        db.save_chat(
            &request("a", &format!("Q{i}")),
            &"가나다".repeat(5000),
            "model",
            "",
        )
        .unwrap();
    }
    let rows = db.paper_chat("a").unwrap();
    let work = summary_work(&rows, None).unwrap();
    assert!(work.accept("not json").is_err());
    assert!(work
        .accept(r#"{"summary":"","important_user_notes":[]}"#)
        .is_err());
    let (recent, omitted) = history_input(&rows, None);
    assert!(omitted);
    assert!(!recent.is_empty());
    assert_eq!(recent.last().unwrap()["question"], "Q14");
    assert_eq!(db.paper_chat("a").unwrap()[0].answer.len(), 45000);
    assert!(work.payload("model")["input"].as_str().unwrap().len() < 70_000);
    // A single huge exchange still retains its beginning/end, rather than removing all history.
    let mut huge = rows[0].clone();
    huge.answer = "앞".repeat(100000) + "마지막 정정";
    let (recent, omitted) = history_input(&[huge], None);
    assert!(omitted);
    assert_eq!(recent.len(), 1);
    assert!(recent[0]["answer"]
        .as_str()
        .unwrap()
        .ends_with("마지막 정정"));
    assert!(recent[0].to_string().len() < 50_000);
    assert!(bounded_text(&"한글".repeat(1000), 100).len() <= 100);
}

#[test]
fn v15_upgrade_preserves_chat_and_adds_only_a_derived_cache() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db");
    let db = Database::open(&path).unwrap();
    register(&db, "a");
    db.save_chat(&request("a", "기존 질문"), "기존 답변", "model", "high")
        .unwrap();
    drop(db);
    let sql = rusqlite::Connection::open(&path).unwrap();
    sql.execute_batch("DROP TABLE paper_chat_memory; PRAGMA user_version=15;")
        .unwrap();
    drop(sql);
    let db = Database::open(&path).unwrap();
    let rows = db.paper_chat("a").unwrap();
    assert_eq!(rows[0].answer, "기존 답변");
    assert!(db.chat_memory("a", &rows).unwrap().is_none());
}
