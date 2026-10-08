use paper_vocabulary_lib::{
    ai,
    db::Database,
    models::{ActionType, LookupRequest, Paper, PositionData},
    papers,
};
use rusqlite::Connection;
use std::fs;

fn request(paper_id: &str) -> LookupRequest {
    LookupRequest {
        paper_id: paper_id.into(),
        page_number: 7,
        word: "Asymptotic".into(),
        original_sentence: "The model maintains an asymptotic linear complexity.".into(),
        action: ActionType::Translation,
        color: Default::default(),
        position: PositionData {
            version: 1,
            rects: vec![[72.0, 300.0, 129.5, 314.0]],
            start_offset: 23,
            end_offset: 33,
        },
    }
}

#[test]
fn restores_only_requested_locations_after_database_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.db");
    let mut db = Database::open(&path).unwrap();
    db.register_paper(
        &Paper {
            id: "paper-a".into(),
            file_name: "a.pdf".into(),
            title: "a.pdf".into(),
        },
        dir.path(),
    )
    .unwrap();
    assert!(db.highlights("paper-a").unwrap().is_empty());
    let selected = request("paper-a");
    let first = db.save_lookup(&selected, "점근적인").unwrap();
    let mut explanation = selected.clone();
    explanation.action = ActionType::Explanation;
    let second = db
        .save_lookup(&explanation, "극한에서의 성질을 나타냅니다.")
        .unwrap();
    assert_eq!(first.id, second.id);
    let mut another_location = selected.clone();
    another_location.page_number = 8;
    another_location.position.rects = vec![[100.0, 90.0, 157.5, 104.0]];
    let third = db.save_lookup(&another_location, "점근적인").unwrap();
    assert_eq!(first.vocabulary_entry_id, third.vocabulary_entry_id);
    drop(db);
    let db = Database::open(&path).unwrap();
    let restored = db.highlights("paper-a").unwrap();
    assert_eq!(restored.len(), 2);
    assert_eq!(restored[0].position, selected.position);
    assert_eq!(restored[1].page_number, 8);
    assert!(db.highlights("paper-b").unwrap().is_empty());
    let connection = Connection::open(&path).unwrap();
    let values: (String, String, String) = connection
        .query_row(
            "SELECT word, translation, explanation FROM vocabulary_entries",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(
        values,
        (
            "asymptotic".into(),
            "점근적인".into(),
            "극한에서의 성질을 나타냅니다.".into()
        )
    );
    let contexts: i64 = connection
        .query_row("SELECT COUNT(*) FROM vocabulary_contexts", [], |r| r.get(0))
        .unwrap();
    assert_eq!(contexts, 3);
}

#[test]
fn failed_write_rolls_back_vocabulary_context_and_highlight_together() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.db");
    let mut db = Database::open(&path).unwrap();
    assert!(db
        .save_lookup(&request("missing-paper"), "점근적인")
        .is_err());
    let connection = Connection::open(&path).unwrap();
    for table in ["vocabulary_entries", "vocabulary_contexts", "highlights"] {
        let count: i64 = connection
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
}

#[test]
fn import_is_content_addressed_and_preserves_original_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let papers_dir = dir.path().join("papers");
    fs::create_dir(&papers_dir).unwrap();
    let source = dir.path().join("논문.pdf");
    let copy = dir.path().join("renamed.pdf");
    let content = b"%PDF-1.7\noriginal test content\n%%EOF";
    fs::write(&source, content).unwrap();
    fs::copy(&source, &copy).unwrap();
    let db = Database::open(&dir.path().join("test.db")).unwrap();
    let first = papers::import_pdf(&source, &papers_dir, &db).unwrap();
    let second = papers::import_pdf(&copy, &papers_dir, &db).unwrap();
    assert_eq!(first.id, second.id);
    assert_eq!(second.file_name, "renamed.pdf");
    assert_eq!(second.title, "renamed.pdf");
    assert_eq!(fs::read(&source).unwrap(), content);
    assert_eq!(
        fs::read(db.paper_path(&first.id).unwrap()).unwrap(),
        content
    );
    assert_eq!(fs::read_dir(&papers_dir).unwrap().count(), 1);
    assert!(db.highlights(&first.id).unwrap().is_empty());
    fs::write(&copy, b"not a PDF").unwrap();
    assert!(papers::import_pdf(&copy, &papers_dir, &db).is_err());
}

#[test]
fn rejects_invalid_selection_and_empty_result() {
    let mut selected = request("paper");
    selected.position.rects[0][2] = f64::NAN;
    assert!(selected.validate().is_err());
    selected = request("paper");
    selected.word = "two words".into();
    assert!(selected.validate().is_err());
    selected = request("paper");
    selected.original_sentence = "x".repeat(1601);
    assert!(selected.validate().is_err());
    let dir = tempfile::tempdir().unwrap();
    let mut db = Database::open(&dir.path().join("test.db")).unwrap();
    assert!(db.save_lookup(&request("paper"), "  ").is_err());
}

#[test]
fn api_payload_contains_only_word_context_and_short_korean_task() {
    let payload = ai::request_body(&request("private-id"));
    assert_eq!(payload["model"], "gpt-5.6-luna");
    assert_eq!(payload["store"], false);
    assert_eq!(payload["reasoning"]["effort"], "none");
    assert!(!payload.to_string().contains("private-id"));
    assert!(payload["input"].as_str().unwrap().contains("asymptotic"));
    assert_eq!(payload["max_output_tokens"], 80);
}

#[test]
fn refuses_partial_empty_and_refused_api_output() {
    use serde_json::json;
    for body in [
        json!({"status":"incomplete", "output":[]}),
        json!({"status":"completed", "output":[]}),
        json!({"status":"completed", "output":[{"type":"message","content":[{"type":"refusal","refusal":"No"}]}]}),
    ] {
        assert!(ai::extract_result(&body).is_err());
    }
    let body = json!({"status":"completed", "output":[
        {"type":"reasoning","summary":[]},
        {"type":"message","content":[{"type":"output_text","text":" 점근적인 "}]}]});
    assert_eq!(ai::extract_result(&body).unwrap(), "점근적인");
}
