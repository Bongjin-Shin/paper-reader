use paper_vocabulary_lib::{
    ai,
    db::Database,
    models::{ActionType, LookupRequest, Paper, PositionData, TextLookupRequest},
    papers,
    usage::{parse_credit, AiResult, Pricing, TokenUsage},
};
use rusqlite::Connection;
use serde_json::json;
use std::fs;

fn response(id: &str) -> AiResult {
    AiResult {
        provider: paper_vocabulary_lib::connection::AiProvider::Api,
        text: "문맥을 고려한 결과입니다.".into(),
        response_id: Some(id.into()),
        usage: TokenUsage {
            input: 1000,
            cached_input: 200,
            cache_write: 100,
            output: 300,
            estimated: false,
        },
    }
}

#[test]
fn actual_usage_prices_cached_and_written_tokens_without_double_counting() {
    let usage = TokenUsage::from_response(
        &json!({"usage":{"input_tokens":1000,
        "input_tokens_details":{"cached_tokens":200,"cache_write_tokens":100},"output_tokens":300}}),
        &json!({}),
        "ignored",
    );
    assert!(!usage.estimated);
    assert_eq!(usage.cost(&Pricing::default()).unwrap(), 529_000);
}

#[test]
fn missing_or_invalid_usage_is_marked_as_an_estimate() {
    for body in [
        json!({}),
        json!({"usage":{"input_tokens":2,"input_tokens_details":{"cached_tokens":3},"output_tokens":1}}),
    ] {
        let usage = TokenUsage::from_response(
            &body,
            &json!({"instructions":"task","input":"selected text"}),
            "한국어",
        );
        assert!(usage.estimated);
        assert_eq!(usage.input, 4 + 13 + 16);
        assert_eq!(usage.output, 9);
        assert!(usage.cost(&Pricing::default()).unwrap() > 0);
    }
}

#[test]
fn credit_is_exact_validated_and_can_be_zero() {
    assert_eq!(parse_credit("5.01").unwrap(), 5_010_000_000);
    assert_eq!(parse_credit("0").unwrap(), 0);
    assert_eq!(parse_credit("0.1").unwrap(), 100_000_000);
    assert_eq!(parse_credit("1000000").unwrap(), 1_000_000_000_000_000);
    for invalid in [
        "",
        "-1",
        "NaN",
        "inf",
        "5.001",
        "1e10",
        "1000001",
        "1000000.01",
        "1.2.3",
    ] {
        assert!(parse_credit(invalid).is_err(), "{invalid}");
    }
}

#[test]
fn phrase_results_save_vocabulary_and_usage_and_survive_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let mut db = Database::open(&path).unwrap();
    assert!(db.usage_summary().unwrap().estimated_balance_usd.is_none());
    db.set_initial_credit("5.00").unwrap();
    db.register_paper(
        &Paper {
            id: "paper".into(),
            file_name: "paper.pdf".into(),
            title: "Paper".into(),
        },
        dir.path(),
    )
    .unwrap();
    let request = TextLookupRequest {
        paper_id: "paper".into(),
        page_number: 1,
        selected_text: "The entire selected sentence.".into(),
        context: "The entire selected sentence. Next.".into(),
        action: ActionType::Translation,
    };
    let result = db
        .complete_text_lookup(&request, response("phrase-1"))
        .unwrap();
    assert!(result.highlight.is_none());
    assert_eq!(result.text, "문맥을 고려한 결과입니다.");
    db.complete_text_lookup(&request, response("phrase-2"))
        .unwrap();
    db.record_usage(&response("phrase-2")).unwrap(); // Same provider response is never charged twice.
    drop(db);
    let db = Database::open(&path).unwrap();
    let usage = db.usage_summary().unwrap();
    assert_eq!(usage.total_cost_usd, 0.001058);
    assert_eq!(usage.estimated_balance_usd, Some(4.998942));
    let changed = db.set_initial_credit("10").unwrap();
    assert_eq!(changed.total_cost_usd, usage.total_cost_usd);
    assert_eq!(changed.estimated_balance_usd, Some(9.998942));
    let connection = Connection::open(&path).unwrap();
    for (table, count) in [
        ("vocabulary_entries", 1),
        ("vocabulary_contexts", 2),
        ("highlights", 0),
    ] {
        assert_eq!(
            connection
                .query_row::<i64, _, _>(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row
                    .get(0))
                .unwrap(),
            count
        );
    }
    assert_eq!(
        connection
            .query_row::<i64, _, _>("SELECT COUNT(*) FROM api_usage", [], |row| row.get(0))
            .unwrap(),
        2
    );
}

#[test]
fn successful_word_request_saves_highlight_and_usage_together_in_the_flow() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Database::open(&dir.path().join("data.db")).unwrap();
    db.register_paper(
        &Paper {
            id: "paper".into(),
            file_name: "a.pdf".into(),
            title: "a.pdf".into(),
        },
        dir.path(),
    )
    .unwrap();
    let word = LookupRequest {
        paper_id: "paper".into(),
        page_number: 1,
        word: "game-theoretical".into(),
        original_sentence: "A game-theoretical framework.".into(),
        action: ActionType::Explanation,
        color: Default::default(),
        position: PositionData {
            version: 1,
            rects: vec![[10., 20., 90., 34.]],
            start_offset: 2,
            end_offset: 18,
        },
    };
    let result = db.complete_lookup(Some(&word), response("word-1")).unwrap();
    assert_eq!(result.highlight.unwrap().selected_text, "game-theoretical");
    assert_eq!(db.highlights("paper").unwrap().len(), 1);
    assert_eq!(db.usage_summary().unwrap().total_cost_usd, 0.000529);
}

#[test]
fn migration_from_phase_one_preserves_existing_papers_words_and_coordinates() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("v1.db");
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(include_str!("../migrations/001_initial.sql"))
        .unwrap();
    conn.execute_batch("INSERT INTO papers(id,file_name,file_path,title) VALUES ('paper','a.pdf','a.pdf','a.pdf');
      INSERT INTO vocabulary_entries(id,word,translation) VALUES (1,'allocation','할당');
      INSERT INTO vocabulary_contexts(id,vocabulary_entry_id,paper_id,page_number,original_sentence,action_type,result)
      VALUES (1,1,'paper',7,'Task allocation.','translation','할당');").unwrap();
    let position = r#"{"version":1,"rects":[[72,300,129.5,314]],"startOffset":5,"endOffset":15}"#;
    conn.execute("INSERT INTO highlights(id,paper_id,vocabulary_entry_id,context_id,page_number,selected_text,position_data)
      VALUES (1,'paper',1,1,7,'allocation',?1)", [position]).unwrap();
    drop(conn);
    let db = Database::open(&path).unwrap();
    let saved = db.highlights("paper").unwrap();
    assert_eq!(saved.len(), 1);
    assert_eq!(saved[0].page_number, 7);
    assert_eq!(saved[0].position.rects, vec![[72., 300., 129.5, 314.]]);
    assert_eq!(db.usage_summary().unwrap().total_cost_usd, 0.0);
    let connection = Connection::open(path).unwrap();
    assert_eq!(
        connection
            .query_row::<String, _, _>(
                "SELECT translation FROM vocabulary_entries WHERE id=1",
                [],
                |r| r.get(0)
            )
            .unwrap(),
        "할당"
    );
    assert_eq!(
        connection
            .query_row::<i64, _, _>("PRAGMA user_version", [], |r| r.get(0))
            .unwrap(),
        15
    );
    assert_eq!(db.vocabulary("", None).unwrap()[0].lookup_count, 1);
}

#[test]
fn full_selected_text_and_context_are_not_truncated_or_replaced_by_one_word() {
    let text =
        "A game-theoretical approach considers\ndecision-making under uncertainty.".repeat(20);
    for action in [ActionType::Translation, ActionType::Explanation] {
        let request = TextLookupRequest {
            paper_id: "paper".into(),
            page_number: 1,
            selected_text: text.clone(),
            context: format!("Before. {text} After."),
            action,
        };
        request.validate().unwrap();
        let body = ai::text_request_body(&request);
        let input: serde_json::Value =
            serde_json::from_str(body["input"].as_str().unwrap()).unwrap();
        assert_eq!(input["selected_text"], text);
        assert_eq!(input["context"], request.context);
        assert_eq!(body["model"], "gpt-5.6-luna");
        assert!(!body.to_string().contains("paper_id"));
    }
}

#[test]
fn drops_accept_pdfs_and_import_still_validates_each_file_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let pdf = dir.path().join("paper.PDF");
    let text = dir.path().join("paper.txt");
    fs::write(&pdf, b"%PDF-1.7\n%%EOF").unwrap();
    fs::write(&text, b"%PDF-1.7\n%%EOF").unwrap();
    assert_eq!(
        papers::dropped_pdfs(std::slice::from_ref(&pdf)).unwrap(),
        vec![pdf.clone()]
    );
    assert!(papers::dropped_pdfs(&[]).is_err());
    assert_eq!(
        papers::dropped_pdfs(&[pdf.clone(), text.clone()]).unwrap(),
        vec![pdf.clone(), text.clone()]
    );
    assert!(papers::dropped_pdfs(std::slice::from_ref(&text)).is_err());
    assert!(papers::dropped_pdfs(&[dir.path().join("missing.pdf")]).is_err());
    let db = Database::open(&dir.path().join("data.db")).unwrap();
    assert!(papers::import_pdf(&text, dir.path(), &db).is_err());
    fs::write(&pdf, b"Not really a PDF").unwrap();
    assert!(papers::import_pdf(&pdf, dir.path(), &db).is_err());
}
