use paper_vocabulary_lib::{
    connection::AiProvider,
    db::Database,
    models::Paper,
    page_translation::{
        parse_result, request_body, translate_page, PageTranslationRequest, SourceSentence,
    },
    usage::{AiResult, TokenUsage},
};
use serde_json::json;
use std::{path::Path, sync::Mutex};
fn request() -> PageTranslationRequest {
    PageTranslationRequest {
        force: false,
        paper_id: "paper".into(),
        page_number: 1,
        sentences: vec![
            SourceSentence {
                id: 0,
                text: "A game-theoretical method works.".into(),
                rects: vec![[10., 20., 190., 32.]],
                layout: None,
            },
            SourceSentence {
                id: 1,
                text: "Another sentence follows.".into(),
                rects: vec![[10., 5., 160., 17.]],
                layout: None,
            },
        ],
    }
}
fn register(db: &Database) {
    db.register_paper(
        &Paper {
            id: "paper".into(),
            title: "Test".into(),
            file_name: "test.pdf".into(),
        },
        Path::new("test.pdf"),
    )
    .unwrap();
    db.set_initial_credit("5").unwrap();
}
fn response(provider: AiProvider) -> AiResult {
    AiResult { provider, text: json!({"sentences":[{"id":1,"translation":"다음 문장입니다."},{"id":0,"translation":"게임 이론적 방법이 작동합니다."}]}).to_string(),
      response_id: Some("page-response".into()), usage: TokenUsage { input: 1000, output: 100, cached_input: 200, cache_write: 0, estimated: false } }
}
#[tokio::test]
async fn page_cache_survives_restart_without_vocabulary_highlights_or_additional_cost() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db.sqlite");
    let db = Database::open(&path).unwrap();
    register(&db);
    let db = Mutex::new(db);
    let output = translate_page(&db, &request(), || async { Ok(response(AiProvider::Api)) })
        .await
        .unwrap();
    assert_eq!(
        output.sentences[0].source.rects,
        request().sentences[0].rects
    );
    let cost = db.lock().unwrap().usage_summary().unwrap().total_cost_usd;
    assert!(cost > 0.0);
    assert!(db.lock().unwrap().vocabulary("", None).unwrap().is_empty());
    assert!(db.lock().unwrap().highlights("paper").unwrap().is_empty());
    drop(db);
    let db = Mutex::new(Database::open(&path).unwrap());
    translate_page(&db, &request(), || async {
        panic!("cache must precede API validation")
    })
    .await
    .unwrap();
    assert_eq!(
        db.lock().unwrap().usage_summary().unwrap().total_cost_usd,
        cost
    );
    assert!(db
        .lock()
        .unwrap()
        .page_translation("paper", 2)
        .unwrap()
        .is_none());
}
#[tokio::test]
async fn failed_or_malformed_translation_does_not_charge_or_cache_and_retry_succeeds() {
    let db = Database::open(Path::new(":memory:")).unwrap();
    register(&db);
    let db = Mutex::new(db);
    assert!(
        translate_page(&db, &request(), || async { Err("offline".into()) })
            .await
            .is_err()
    );
    for text in [
        "bad",
        r#"{"sentences":[{"id":0,"translation":"하나만"}]}"#,
        r#"{"sentences":[{"id":0,"translation":"a"},{"id":0,"translation":"b"}]}"#,
        r#"{"sentences":[{"id":0,"translation":" "},{"id":1,"translation":"b"}]}"#,
    ] {
        let mut response = response(AiProvider::Api);
        response.text = text.into();
        assert!(translate_page(&db, &request(), || async { Ok(response) })
            .await
            .is_err());
    }
    assert_eq!(
        db.lock().unwrap().usage_summary().unwrap().total_cost_usd,
        0.
    );
    assert!(db
        .lock()
        .unwrap()
        .page_translation("paper", 1)
        .unwrap()
        .is_none());
    translate_page(&db, &request(), || async { Ok(response(AiProvider::Api)) })
        .await
        .unwrap();
}
#[tokio::test]
async fn chatgpt_page_translation_is_cached_without_api_charge() {
    let db = Database::open(Path::new(":memory:")).unwrap();
    register(&db);
    let db = Mutex::new(db);
    translate_page(&db, &request(), || async {
        Ok(response(AiProvider::Chatgpt))
    })
    .await
    .unwrap();
    assert_eq!(
        db.lock().unwrap().usage_summary().unwrap().total_cost_usd,
        0.
    );
    assert!(db
        .lock()
        .unwrap()
        .page_translation("paper", 1)
        .unwrap()
        .is_some());
}
#[tokio::test]
async fn cache_is_scoped_to_paper_page_and_source() {
    let db = Database::open(Path::new(":memory:")).unwrap();
    register(&db);
    let db = Mutex::new(db);
    translate_page(&db, &request(), || async {
        Ok(response(AiProvider::Chatgpt))
    })
    .await
    .unwrap();
    let mut changed = request();
    changed.sentences[0].text = "Changed source.".into();
    assert!(
        translate_page(&db, &changed, || async { Err("cache miss".into()) })
            .await
            .is_err()
    );
    changed = request();
    changed.page_number = 2;
    assert!(
        translate_page(&db, &changed, || async { Err("cache miss".into()) })
            .await
            .is_err()
    );
    changed.paper_id = "missing".into();
    assert!(
        translate_page(&db, &changed, || async { panic!("unknown paper") })
            .await
            .is_err()
    );
}
#[test]
fn request_validation_rejects_bad_ids_empty_oversize_and_invalid_coordinates() {
    let mut req = request();
    req.sentences[0].id = 2;
    assert!(req.validate().is_err());
    req = request();
    req.sentences[0].rects[0][0] = f64::NAN;
    assert!(req.validate().is_err());
    req = request();
    req.sentences[0].text = "a".repeat(20001);
    assert!(req.validate().is_err());
    req.sentences.clear();
    assert!(req.validate().is_err());
}
#[test]
fn prompt_sends_only_numbered_source_and_parser_keeps_local_coordinates() {
    let req = request();
    let body = request_body(&req);
    let input: serde_json::Value = serde_json::from_str(body["input"].as_str().unwrap()).unwrap();
    assert_eq!(input["sentences"][0]["text"], req.sentences[0].text);
    assert!(input["sentences"][0].get("rects").is_none());
    let parsed = parse_result(
        &req,
        &format!("```json\n{}\n```", response(AiProvider::Api).text),
    )
    .unwrap();
    assert_eq!(parsed.sentences[0].source, req.sentences[0]);
}
#[test]
fn migration_from_version_nine_preserves_existing_papers_and_preferences() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db.sqlite");
    let db = Database::open(&path).unwrap();
    register(&db);
    db.set_ai_provider(AiProvider::Chatgpt).unwrap();
    drop(db);
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch(
        "DROP TABLE page_translations; DROP TABLE explanation_cache; DROP TABLE paper_chat_heads; DROP TABLE paper_chat; DROP TABLE shared_sentence_translations; ALTER TABLE ai_preferences DROP COLUMN translation_model; ALTER TABLE ai_preferences DROP COLUMN chat_model; ALTER TABLE ai_preferences DROP COLUMN chat_effort; ALTER TABLE ai_preferences DROP COLUMN translation_effort; ALTER TABLE ai_preferences DROP COLUMN chat_provider; DROP TABLE claude_preferences; PRAGMA user_version = 9;",
    )
    .unwrap();
    drop(conn);
    let db = Database::open(&path).unwrap();
    assert_eq!(db.ai_provider().unwrap(), AiProvider::Chatgpt);
    assert_eq!(db.papers().unwrap().len(), 1);
    assert_eq!(db.usage_summary().unwrap().initial_credit_usd, Some(5.));
    assert!(db.page_translation("paper", 1).unwrap().is_none());
}

#[test]
fn sentence_stream_handles_split_escaped_unicode_objects_and_out_of_order_ids() {
    use paper_vocabulary_lib::page_translation::SentenceStream;
    let text = json!({"sentences":[{"id":1,"translation":"둘째 {문장}."},{"id":0,"translation":"첫째 \"문장\" \\ 예시."}]}).to_string();
    let mut stream = SentenceStream::default();
    let mut rows = vec![];
    for ch in text.chars() {
        rows.extend(stream.push(&ch.to_string(), 2));
    }
    assert_eq!(rows.iter().map(|r| r.id).collect::<Vec<_>>(), vec![0, 1]);
    assert_eq!(rows[0].translation, "첫째 \"문장\" \\ 예시.");
    assert_eq!(rows[1].translation, "둘째 {문장}.");
    assert!(stream.push("", 2).is_empty());
}
#[test]
fn sentence_preview_never_makes_an_incomplete_or_duplicate_response_valid() {
    use paper_vocabulary_lib::page_translation::SentenceStream;
    let prefix = r#"{"sentences":[{"id":0,"translation":"먼저 나온 문장"}"#;
    for suffix in [
        "]}",
        r#",{"id":0,"translation":"중복"}]}"#,
        r#",{"id":2,"translation":"잘못된 id"}]}"#,
        r#",{"id":1,"translation":" "}]}"#,
    ] {
        let mut stream = SentenceStream::default();
        assert_eq!(stream.push(prefix, 2).len(), 1);
        assert!(stream.push(suffix, 2).is_empty());
        assert!(parse_result(&request(), &format!("{prefix}{suffix}")).is_err());
    }
}
#[tokio::test]
async fn legacy_layout_cache_is_kept_but_not_reused_until_an_explicit_translation() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let db = Database::open(&path).unwrap();
    register(&db);
    let db = Mutex::new(db);
    translate_page(&db, &request(), || async {
        Ok(response(AiProvider::Chatgpt))
    })
    .await
    .unwrap();
    drop(db);
    let sql = rusqlite::Connection::open(&path).unwrap();
    sql.execute_batch("ALTER TABLE page_translations DROP COLUMN layout_version; DROP TABLE explanation_cache; DROP TABLE paper_chat_heads; DROP TABLE paper_chat; DROP TABLE shared_sentence_translations; ALTER TABLE ai_preferences DROP COLUMN translation_model; ALTER TABLE ai_preferences DROP COLUMN chat_model; ALTER TABLE ai_preferences DROP COLUMN chat_effort; ALTER TABLE ai_preferences DROP COLUMN translation_effort; ALTER TABLE ai_preferences DROP COLUMN chat_provider; DROP TABLE claude_preferences; PRAGMA user_version = 10;").unwrap();
    drop(sql);
    let db = Mutex::new(Database::open(&path).unwrap());
    assert!(db
        .lock()
        .unwrap()
        .page_translation("paper", 1)
        .unwrap()
        .is_none());
    assert_eq!(db.lock().unwrap().papers().unwrap().len(), 1);
    let sql = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        sql.query_row::<i64, _, _>("SELECT COUNT(*) FROM page_translations", [], |r| r.get(0))
            .unwrap(),
        1
    );
    assert_eq!(
        sql.query_row::<i64, _, _>("PRAGMA user_version", [], |r| r.get(0))
            .unwrap(),
        15
    );
    translate_page(&db, &request(), || async {
        Ok(response(AiProvider::Chatgpt))
    })
    .await
    .unwrap();
    assert!(db
        .lock()
        .unwrap()
        .page_translation("paper", 1)
        .unwrap()
        .is_some());
    assert_eq!(
        sql.query_row::<i64, _, _>("SELECT layout_version FROM page_translations", [], |r| r
            .get(0))
            .unwrap(),
        7
    );
}

#[tokio::test]
async fn layout_and_original_equations_persist_locally_without_sending_coordinates_to_model() {
    use paper_vocabulary_lib::page_translation::{EquationSource, LayoutKind, SentenceLayout};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let db = Database::open(&path).unwrap();
    register(&db);
    let db = Mutex::new(db);
    let mut req = request();
    req.sentences[0].text = "We use [[PV_MATH_0]] in this sentence.".into();
    req.sentences[0].layout = Some(SentenceLayout {
        sources: vec![],
        typography: None,
        paragraph: 0,
        kind: LayoutKind::Paragraph,
        math: vec![EquationSource {
            glyphs: vec![],
            page_number: None,
            token: "[[PV_MATH_0]]".into(),
            text: "E = mc2".into(),
            rect: [30., 20., 70., 40.],
            font_size: 10.,
        }],
    });
    req.validate().unwrap();
    let body = request_body(&req);
    let input: serde_json::Value = serde_json::from_str(body["input"].as_str().unwrap()).unwrap();
    assert_eq!(input["sentences"][0]["equations"][0]["text"], "E = mc2");
    assert!(input["sentences"][0]["equations"][0].get("rect").is_none());
    let mut answer = response(AiProvider::Api);
    answer.text=json!({"sentences":[{"id":0,"translation":"이 문장에서 [[PV_MATH_0]]을 사용합니다.","equations":[{"token":"[[PV_MATH_0]]","latex":"E=mc^2"}]},{"id":1,"translation":"다음 문장입니다."}]}).to_string();
    let output = translate_page(&db, &req, || async { Ok(answer) })
        .await
        .unwrap();
    assert_eq!(output.sentences[0].source, req.sentences[0]);
    drop(db);
    let db = Mutex::new(Database::open(&path).unwrap());
    let saved = translate_page(&db, &req, || async { panic!("must use cached layout") })
        .await
        .unwrap();
    assert_eq!(saved.sentences[0].source.layout, req.sentences[0].layout);
}
#[tokio::test]
async fn lost_or_duplicated_formula_markers_never_save_or_charge_and_invalid_geometry_is_rejected()
{
    use paper_vocabulary_lib::page_translation::{EquationSource, LayoutKind, SentenceLayout};
    let db = Database::open(Path::new(":memory:")).unwrap();
    register(&db);
    let db = Mutex::new(db);
    let mut req = request();
    req.sentences[0].text = "[[PV_MATH_0]]".into();
    req.sentences[0].layout = Some(SentenceLayout {
        sources: vec![],
        typography: None,
        paragraph: 0,
        kind: LayoutKind::Equation,
        math: vec![EquationSource {
            glyphs: vec![],
            page_number: None,
            token: "[[PV_MATH_0]]".into(),
            text: "y = 1/n".into(),
            rect: [30., 20., 70., 40.],
            font_size: 10.,
        }],
    });
    for text in ["수식 생략", "[[PV_MATH_0]] [[PV_MATH_0]]"] {
        let mut answer = response(AiProvider::Api);
        answer.text =
            json!({"sentences":[{"id":0,"translation":text},{"id":1,"translation":"다음 문장"}]})
                .to_string();
        assert!(translate_page(&db, &req, || async { Ok(answer) })
            .await
            .is_err());
    }
    assert_eq!(
        db.lock().unwrap().usage_summary().unwrap().total_cost_usd,
        0.
    );
    assert!(db
        .lock()
        .unwrap()
        .page_translation("paper", 1)
        .unwrap()
        .is_none());
    req.sentences[0].layout.as_mut().unwrap().math[0].rect[0] = f64::NAN;
    assert!(req.validate().is_err());
}
#[tokio::test]
async fn old_line_based_cache_is_not_reused_for_sentence_layout() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let db = Database::open(&path).unwrap();
    register(&db);
    let db = Mutex::new(db);
    translate_page(&db, &request(), || async {
        Ok(response(AiProvider::Chatgpt))
    })
    .await
    .unwrap();
    let sql = rusqlite::Connection::open(&path).unwrap();
    sql.execute("UPDATE page_translations SET layout_version=6", [])
        .unwrap();
    assert!(db
        .lock()
        .unwrap()
        .page_translation("paper", 1)
        .unwrap()
        .is_none());
    assert_eq!(
        sql.query_row::<i64, _, _>("SELECT COUNT(*) FROM page_translations", [], |r| r.get(0))
            .unwrap(),
        1
    );
    translate_page(&db, &request(), || async {
        Err("explicit fresh request".into())
    })
    .await
    .unwrap_err();
}

#[tokio::test]
async fn repeated_cross_page_sentence_keeps_exact_translation_regardless_of_completion_order() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("db.sqlite")).unwrap();
    register(&db);
    let db = Mutex::new(db);
    let mut second = request();
    second.page_number = 2;
    let saved = translate_page(&db, &second, || async { Ok(response(AiProvider::Chatgpt)) })
        .await
        .unwrap();
    let mut different = response(AiProvider::Chatgpt);
    different.text = json!({"sentences":[{"id":0,"translation":"다른 표현"},{"id":1,"translation":"다른 두 번째 문장"}]}).to_string();
    let first = translate_page(&db, &request(), || async { Ok(different) })
        .await
        .unwrap();
    assert_eq!(
        first.sentences[0].translation,
        saved.sentences[0].translation
    );
    assert_eq!(
        first.sentences[1].translation,
        saved.sentences[1].translation
    );
}

#[tokio::test]
async fn explicit_retranslation_bypasses_all_caches_and_updates_duplicate_sentences_after_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let db = Database::open(&path).unwrap(); register(&db);
    let db = Mutex::new(db);
    let original = translate_page(&db, &request(), || async { Ok(response(AiProvider::Api)) }).await.unwrap();
    let mut next = request(); next.page_number = 2;
    next.sentences[1].text = "Unrelated next-page sentence.".into();
    translate_page(&db, &next, || async { Ok(response(AiProvider::Api)) }).await.unwrap();
    let mut forced = request(); forced.force = true;
    let prior_cost = db.lock().unwrap().usage_summary().unwrap().total_cost_usd;
    assert!(translate_page(&db, &forced, || async { Err("offline".into()) }).await.is_err());
    assert_eq!(db.lock().unwrap().usage_summary().unwrap().total_cost_usd, prior_cost);
    assert_eq!(db.lock().unwrap().page_translation("paper", 1).unwrap().unwrap().sentences[0].translation, original.sentences[0].translation);
    let mut fresh = response(AiProvider::Api);
    fresh.response_id = Some("retranslation-response".into());
    fresh.text = json!({"sentences":[{"id":0,"translation":"새 번역입니다.","equations":[]},{"id":1,"translation":"수정한 문장입니다.","equations":[]}]}).to_string();
    let updated = translate_page(&db, &forced, || async { Ok(fresh) }).await.unwrap();
    assert_eq!(updated.sentences[0].translation, "새 번역입니다.");
    assert!(db.lock().unwrap().usage_summary().unwrap().total_cost_usd > prior_cost);
    drop(db);
    let db = Mutex::new(Database::open(&path).unwrap());
    let first = db.lock().unwrap().page_translation("paper", 1).unwrap().unwrap();
    let second = db.lock().unwrap().page_translation("paper", 2).unwrap().unwrap();
    assert_eq!(first.sentences[0].translation, "새 번역입니다.");
    assert_eq!(second.sentences[0].translation, first.sentences[0].translation);
    assert_eq!(second.sentences[1].translation, "다음 문장입니다.");
    translate_page(&db, &next, || async { panic!("Adjacent page should still be cached") }).await.unwrap();
    assert_eq!(db.lock().unwrap().papers().unwrap().len(), 1);
    assert!(db.lock().unwrap().vocabulary("", None).unwrap().is_empty());
}

#[test]
fn latex_is_required_per_formula_and_streamed_as_a_complete_sentence() {
    use paper_vocabulary_lib::page_translation::{EquationGlyph, EquationSource, LayoutKind, SentenceLayout, SentenceStream};
    let mut req = request();
    req.sentences[0].text = "Energy is [[PV_MATH_1000]].".into();
    req.sentences[0].layout = Some(SentenceLayout { paragraph: 0, kind: LayoutKind::Paragraph, sources: vec![], typography: None,
        math: vec![EquationSource { token: "[[PV_MATH_1000]]".into(), text: "E = mc 2".into(), rect: [10., 20., 90., 40.],
            font_size: 12., page_number: Some(1), glyphs: vec![EquationGlyph { text: "2".into(), x: 33., y: 6., size: 7. }] }] });
    req.validate().unwrap();
    let input: serde_json::Value = serde_json::from_str(request_body(&req)["input"].as_str().unwrap()).unwrap();
    assert_eq!(input["sentences"][0]["kind"], "paragraph");
    assert_eq!(input["sentences"][0]["equations"][0]["glyphs"][0]["y"], 6.);
    assert!(input["sentences"][0]["equations"][0].get("rect").is_none());
    let equations = json!([{"token":"[[PV_MATH_1000]]","latex":"E=mc^2"}]);
    let text = json!({"sentences":[{"id":0,"translation":"에너지는 [[PV_MATH_1000]]입니다.","equations":equations}, {"id":1,"translation":"다음 문장입니다.","equations":[]}]}).to_string();
    let parsed = parse_result(&req, &text).unwrap();
    assert_eq!(parsed.sentences[0].equations[0].latex, "E=mc^2");
    let mut stream = SentenceStream::default(); let mut rows = vec![];
    for ch in text.chars() { rows.extend(stream.push(&ch.to_string(), 2)); }
    assert_eq!(rows[0].equations, parsed.sentences[0].equations);
    for bad in [json!([]), json!([{"token":"[[PV_MATH_9999]]","latex":"x"}]), json!([{"token":"[[PV_MATH_1000]]","latex":""}]),
        json!([{"token":"[[PV_MATH_1000]]","latex":"x"},{"token":"[[PV_MATH_1000]]","latex":"y"}])] {
        let mut value: serde_json::Value = serde_json::from_str(&text).unwrap(); value["sentences"][0]["equations"] = bad;
        assert!(parse_result(&req, &value.to_string()).is_err());
    }
    let mut value: serde_json::Value = serde_json::from_str(&text).unwrap();
    value["sentences"][1]["translation"] = json!("Invented [[PV_MATH_9999]]");
    assert!(parse_result(&req, &value.to_string()).is_err());
    req.sentences[0].layout.as_mut().unwrap().math[0].glyphs[0].y = f64::NAN;
    assert!(req.validate().is_err());
}
