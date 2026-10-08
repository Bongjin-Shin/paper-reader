#![cfg(unix)]
use paper_vocabulary_lib::{
    ai,
    codex::CodexClient,
    connection::AiProvider,
    db::Database,
    lookup,
    models::{ActionType, LookupRequest, Paper, PositionData, TextLookupRequest},
};
use serde_json::{json, Value};
use std::{fs, os::unix::fs::PermissionsExt, path::Path, sync::Mutex};

fn client(root: &Path, scenario: &str, signed_in: bool) -> CodexClient {
    fs::create_dir_all(root).unwrap();
    let script = root.join("fake-codex");
    fs::write(&script, include_str!("fixtures/codex_server.py")).unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
    fs::write(root.join("scenario"), scenario).unwrap();
    if signed_in {
        fs::write(root.join("signed-in"), "yes").unwrap();
    }
    CodexClient::new(root.into(), Some(script))
}
fn request() -> LookupRequest {
    LookupRequest {
        paper_id: "paper".into(),
        page_number: 1,
        word: "asymptotic".into(),
        original_sentence: "The asymptotic model is context-aware.".into(),
        action: ActionType::Translation,
        color: Default::default(),
        position: PositionData {
            version: 1,
            rects: vec![[10.0, 20.0, 60.0, 32.0]],
            start_offset: 4,
            end_offset: 14,
        },
    }
}
fn requests(root: &Path) -> Vec<Value> {
    fs::read_to_string(root.join("requests.jsonl"))
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

#[test]
fn managed_login_cancel_logout_and_restart_keep_auth_scoped_to_app() {
    let dir = tempfile::tempdir().unwrap();
    let client = client(dir.path(), "ok", false);
    assert!(!client.status().connected);
    assert!(client
        .login()
        .unwrap()
        .starts_with("https://auth.openai.com/"));
    assert!(client.status().login_pending);
    client.cancel_login().unwrap();
    assert!(!client.status().login_pending);
    client.login().unwrap();
    fs::write(dir.path().join("signed-in"), "yes").unwrap();
    assert!(client.status().connected);
    client.shutdown();
    assert!(client.status().connected);
    client.logout().unwrap();
    assert!(!client.status().connected);
    assert_eq!(
        fs::metadata(dir.path()).unwrap().permissions().mode() & 0o777,
        0o700
    );
    let process: Value =
        serde_json::from_str(&fs::read_to_string(dir.path().join("process.json")).unwrap())
            .unwrap();
    assert_eq!(process["apiKeyInherited"], false);
    assert_eq!(process["accessTokenInherited"], false);
    assert!(process["args"]
        .as_array()
        .unwrap()
        .contains(&json!("forced_login_method=\"chatgpt\"")));
    assert_eq!(
        process["cwd"],
        dir.path().join("workspace").to_str().unwrap()
    );
}

#[test]
fn subscription_lookup_preserves_input_and_accepts_only_completed_final_output() {
    let dir = tempfile::tempdir().unwrap();
    let client = client(dir.path(), "ok", true);
    let payload = ai::request_body(&request());
    let result = client.lookup(payload.clone()).unwrap();
    assert_eq!(result.text, "점근적인");
    assert_eq!(result.provider, AiProvider::Chatgpt);
    let calls = requests(dir.path());
    let thread = calls
        .iter()
        .find(|r| r["method"] == "thread/start")
        .unwrap();
    assert_eq!(
        thread["params"]["developerInstructions"],
        payload["instructions"]
    );
    assert_eq!(thread["params"]["ephemeral"], true);
    assert_eq!(thread["params"]["sandbox"], "read-only");
    let turn = calls.iter().find(|r| r["method"] == "turn/start").unwrap();
    assert_eq!(turn["params"]["input"][0]["text"], payload["input"]);
    assert_eq!(turn["params"]["effort"], "none");
    assert!(calls.iter().any(|r| r["method"] == "thread/unsubscribe"));
}

#[test]
fn unauthenticated_missing_model_failed_turn_malformed_output_and_tools_fail_closed() {
    for (scenario, signed_in, fragment) in [
        ("ok", false, "로그인"),
        ("no-model", true, "모델"),
        ("quota", true, "한도"),
        ("malformed", true, "형식"),
        ("crash", true, "끊어"),
        ("tool", true, "도구"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let client = client(dir.path(), scenario, signed_in);
        let error = client.lookup(ai::request_body(&request())).unwrap_err();
        assert!(error.contains(fragment), "{scenario}: {error}");
        assert!(!error.contains("private-provider-detail"));
        if !signed_in || scenario == "no-model" {
            assert!(!requests(dir.path())
                .iter()
                .any(|r| r["method"] == "turn/start"));
        }
    }
    let dir = tempfile::tempdir().unwrap();
    let missing = CodexClient::new(dir.path().into(), None);
    assert!(!missing.status().installed);
    assert!(missing.login().is_err());
}

#[tokio::test]
async fn cache_highlight_vocabulary_and_api_balance_survive_provider_switch_and_restart() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("vocabulary.db");
    let db = Database::open(&db_path).unwrap();
    db.set_initial_credit("5").unwrap();
    assert_eq!(db.ai_provider().unwrap(), AiProvider::Api);
    db.set_ai_provider(AiProvider::Chatgpt).unwrap();
    db.register_paper(
        &Paper {
            id: "paper".into(),
            file_name: "a.pdf".into(),
            title: "Paper".into(),
        },
        dir.path(),
    )
    .unwrap();
    let db = Mutex::new(db);
    let client = client(&dir.path().join("chatgpt"), "ok", true);
    let word = request();
    let result = lookup::lookup_word(&db, &word, || async {
        client.lookup(ai::request_body(&word))
    })
    .await
    .unwrap();
    assert!(result.highlight.is_some());
    let phrase = TextLookupRequest {
        paper_id: "paper".into(),
        page_number: 1,
        selected_text: "context-aware model".into(),
        context: "The asymptotic context-aware model is efficient.".into(),
        action: ActionType::Explanation,
    };
    lookup::lookup_text(&db, &phrase, || async {
        client.lookup(ai::text_request_body(&phrase))
    })
    .await
    .unwrap();
    let calls = requests(&dir.path().join("chatgpt"));
    let last = calls.iter().rfind(|r| r["method"] == "turn/start").unwrap();
    assert_eq!(
        last["params"]["input"][0]["text"],
        ai::text_request_body(&phrase)["input"]
    );
    client.logout().unwrap();
    // Cache works without authentication, then across the provider switch, without fetching.
    lookup::lookup_word(&db, &word, || async {
        panic!("cache must precede authentication")
    })
    .await
    .unwrap();
    db.lock().unwrap().set_ai_provider(AiProvider::Api).unwrap();
    lookup::lookup_text(&db, &phrase, || async {
        panic!("cache must precede API key validation")
    })
    .await
    .unwrap();
    let guard = db.lock().unwrap();
    assert_eq!(
        guard.usage_summary().unwrap().estimated_balance_usd,
        Some(5.0)
    );
    assert_eq!(guard.vocabulary("", None).unwrap().len(), 1);
    assert_eq!(guard.highlights("paper").unwrap().len(), 1);
    guard.set_ai_provider(AiProvider::Chatgpt).unwrap();
    drop(guard);
    drop(db);
    let reopened = Database::open(&db_path).unwrap();
    assert_eq!(reopened.ai_provider().unwrap(), AiProvider::Chatgpt);
    assert_eq!(reopened.usage_summary().unwrap().total_cost_usd, 0.0);
    assert_eq!(reopened.vocabulary("", None).unwrap().len(), 1);
    let sql = rusqlite::Connection::open(db_path).unwrap();
    assert_eq!(
        sql.query_row::<i64, _, _>("SELECT COUNT(*) FROM api_usage", [], |r| r.get(0))
            .unwrap(),
        0
    );
}

#[test]
fn closing_client_interrupts_a_stalled_turn_and_reaps_process() {
    let dir = tempfile::tempdir().unwrap();
    let client = std::sync::Arc::new(client(dir.path(), "slow", true));
    let worker = client.clone();
    let task = std::thread::spawn(move || worker.lookup(ai::request_body(&request())));
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while !fs::read_to_string(dir.path().join("requests.jsonl"))
        .unwrap_or_default()
        .contains("turn/start")
    {
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    let before = std::time::Instant::now();
    client.shutdown();
    assert!(task.join().unwrap().unwrap_err().contains("취소"));
    assert!(before.elapsed() < std::time::Duration::from_secs(2));
}

#[test]
#[ignore = "manual verification against installed official runtime, no account or model request"]
fn installed_runtime_initializes_without_inheriting_credentials() {
    let dir = tempfile::tempdir().unwrap();
    let binary =
        paper_vocabulary_lib::codex::find_binary(dir.path(), None).expect("installed Codex CLI");
    let client = CodexClient::new(dir.path().into(), Some(binary));
    let status = client.status();
    assert!(status.installed);
    assert!(!status.connected);
    assert!(status.error.is_none(), "{:?}", status.error);
    let url = client.login().expect("official managed login can start");
    assert!(paper_vocabulary_lib::codex::validate_login_url(&url).is_ok());
    client
        .cancel_login()
        .expect("official login can be cancelled");
    assert!(!client.status().login_pending);
}

#[tokio::test]
async fn full_page_translation_uses_existing_subscription_transport_and_cache() {
    use paper_vocabulary_lib::page_translation::{self, PageTranslationRequest, SourceSentence};
    let dir = tempfile::tempdir().unwrap();
    let client = client(&dir.path().join("chatgpt"), "page", true);
    let db = Database::open(&dir.path().join("data.db")).unwrap();
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
    let db = Mutex::new(db);
    let request = PageTranslationRequest {
        paper_id: "paper".into(),
        page_number: 1,
        sentences: vec![SourceSentence {
            id: 0,
            text: "A complete sentence.".into(),
            rects: vec![[10., 20., 100., 32.]],
            layout: None,
        }],
    };
    let result = page_translation::translate_page(&db, &request, || async {
        client.lookup(page_translation::request_body(&request))
    })
    .await
    .unwrap();
    assert_eq!(result.sentences[0].translation, "문장 0 번역");
    assert_eq!(
        db.lock()
            .unwrap()
            .usage_summary()
            .unwrap()
            .estimated_balance_usd,
        Some(5.)
    );
    page_translation::translate_page(&db, &request, || async { panic!("must use page cache") })
        .await
        .unwrap();
    assert_eq!(
        requests(&dir.path().join("chatgpt"))
            .iter()
            .filter(|r| r["method"] == "turn/start")
            .count(),
        1
    );
}

#[test]
fn subscription_stream_emits_only_matching_final_message_before_completed_turn() {
    use paper_vocabulary_lib::page_translation::{
        self, PageTranslationRequest, SentenceStream, SourceSentence,
    };
    let dir = tempfile::tempdir().unwrap();
    let client = client(dir.path(), "page-stream-gated", true);
    let request = PageTranslationRequest {
        paper_id: "paper".into(),
        page_number: 1,
        sentences: (0..2)
            .map(|id| SourceSentence {
                id,
                text: format!("Sentence {id}."),
                rects: vec![[10., 20., 100., 32.]],
                layout: None,
            })
            .collect(),
    };
    let mut stream = SentenceStream::default();
    let mut seen = vec![];
    let result = client
        .lookup_stream(page_translation::request_body(&request), |delta| {
            let rows = stream.push(delta, 2);
            if seen.is_empty() && !rows.is_empty() {
                assert!(!dir.path().join("final-sent").exists());
                fs::write(dir.path().join("preview-seen"), "yes").unwrap();
            }
            seen.extend(rows);
        })
        .unwrap();
    assert_eq!(seen.iter().map(|s| s.id).collect::<Vec<_>>(), vec![0, 1]);
    assert_eq!(seen[0].translation, "문장 0 번역");
    assert_eq!(
        page_translation::parse_result(&request, &result.text)
            .unwrap()
            .sentences
            .len(),
        2
    );
    let calls = requests(dir.path());
    let turn = calls.iter().find(|r| r["method"] == "turn/start").unwrap();
    assert_eq!(
        turn["params"]["outputSchema"],
        page_translation::output_schema()
    );
}
#[test]
fn subscription_stream_partial_output_cannot_turn_a_failed_turn_into_success() {
    use paper_vocabulary_lib::page_translation::{self, PageTranslationRequest, SourceSentence};
    let dir = tempfile::tempdir().unwrap();
    let client = client(dir.path(), "page-stream-fail", true);
    let request = PageTranslationRequest {
        paper_id: "paper".into(),
        page_number: 1,
        sentences: vec![SourceSentence {
            id: 0,
            text: "Sentence.".into(),
            rects: vec![[10., 20., 100., 32.]],
            layout: None,
        }],
    };
    let mut preview = String::new();
    assert!(client
        .lookup_stream(page_translation::request_body(&request), |delta| preview
            .push_str(delta))
        .is_err());
    assert!(preview.contains("문장 0 번역"));
}

#[test]
fn model_catalog_and_independent_chat_effort_reach_the_runtime_without_fallback() {
    let dir = tempfile::tempdir().unwrap();
    let client = client(dir.path(), "models", true);
    let models = client.models().unwrap();
    assert_eq!(models[1].efforts, vec!["medium", "high"]);
    let mut payload = ai::request_body(&request());
    payload["model"] = json!("test-reasoner");
    payload["chatEffort"] = json!("high");
    payload["paperChat"] = json!(true);
    client.lookup(payload.clone()).unwrap();
    let sent = requests(dir.path());
    assert_eq!(
        sent.iter().find(|r| r["method"] == "thread/start").unwrap()["params"]["model"],
        "test-reasoner"
    );
    assert_eq!(
        sent.iter().find(|r| r["method"] == "turn/start").unwrap()["params"]["effort"],
        "high"
    );
    let turns = sent.iter().filter(|r| r["method"] == "turn/start").count();
    payload["chatEffort"] = json!("none");
    assert!(client.lookup(payload).unwrap_err().contains("effort"));
    assert_eq!(
        requests(dir.path())
            .iter()
            .filter(|r| r["method"] == "turn/start")
            .count(),
        turns
    );
}

#[test]
fn paper_chat_streams_markdown_accepts_steering_and_tracks_quota_during_silence() {
    use paper_vocabulary_lib::codex::ChatEvent;
    use std::{
        sync::{mpsc, Arc},
        time::Duration,
    };
    let dir = tempfile::tempdir().unwrap();
    let client = Arc::new(client(dir.path(), "chat-live", true));
    let quota = client.subscription_usage().unwrap();
    assert_eq!(quota.buckets[0].primary.as_ref().unwrap().used_percent, 25.);
    let (tx, rx) = mpsc::channel();
    let worker = client.clone();
    let task = std::thread::spawn(move || {
        worker.chat("request-a", json!({"model":"test-reasoner","chatEffort":"high","instructions":"Explain the paper.","input":"Question"}), |e| { tx.send(e).unwrap(); })
    });
    loop {
        if let ChatEvent::Answer { text } = rx.recv_timeout(Duration::from_secs(5)).unwrap() {
            assert!(text.contains("잔차"));
            assert!(!text.contains("wrong"));
            break;
        }
    }
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    loop {
        let usage = client.subscription_usage().unwrap();
        if usage.buckets[0].primary.as_ref().unwrap().used_percent == 31. {
            break;
        }
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(client
        .control_chat("request-other", Some("Wrong".into()))
        .is_err());
    client
        .control_chat("request-a", Some("기호도 설명해 주세요".into()))
        .unwrap();
    let reply = task.join().unwrap().unwrap();
    assert_eq!(reply.followups, ["기호도 설명해 주세요"]);
    assert_eq!(reply.model, "test-reasoner");
    assert_eq!(reply.effort, "high");
    assert!(!reply.interrupted);
    assert!(reply.answer.contains("추가 질문도"));
    assert!(!reply.answer.contains("wrong"));
    assert!(rx
        .try_iter()
        .any(|e| matches!(e, ChatEvent::Accepted { .. })));
    let calls = requests(dir.path());
    let start = &calls.iter().find(|r| r["method"] == "turn/start").unwrap()["params"];
    assert!(start.get("outputSchema").is_none());
    assert_eq!(start["effort"], "high");
    let thread = &calls
        .iter()
        .find(|r| r["method"] == "thread/start")
        .unwrap()["params"];
    assert!(thread["baseInstructions"]
        .as_str()
        .unwrap()
        .contains("academic tutor"));
    assert_eq!(thread["config"]["model_verbosity"], "high");
    let steer = &calls.iter().find(|r| r["method"] == "turn/steer").unwrap()["params"];
    assert_eq!(steer["expectedTurnId"], "turn-1");
    assert!(client.control_chat("request-a", None).is_err());
}

#[test]
fn paper_chat_can_interrupt_a_silent_turn_and_preserves_partial_answer_after_rejected_steer() {
    use paper_vocabulary_lib::codex::ChatEvent;
    use std::{
        sync::{mpsc, Arc},
        time::Duration,
    };
    for scenario in ["chat-live", "chat-steer-fail"] {
        let dir = tempfile::tempdir().unwrap();
        let client = Arc::new(client(dir.path(), scenario, true));
        let (tx, rx) = mpsc::channel();
        let worker = client.clone();
        let task = std::thread::spawn(move || {
            worker.chat(
                "request",
                json!({"model":"test-reasoner","input":"Question","instructions":"Explain."}),
                |e| {
                    tx.send(e).unwrap();
                },
            )
        });
        loop {
            if matches!(
                rx.recv_timeout(Duration::from_secs(5)).unwrap(),
                ChatEvent::Answer { .. }
            ) {
                break;
            }
        }
        if scenario == "chat-steer-fail" {
            assert!(client
                .control_chat("request", Some("추가 질문".into()))
                .is_err());
        }
        client.control_chat("request", None).unwrap();
        let reply = task.join().unwrap().unwrap();
        assert!(reply.interrupted);
        assert!(reply.answer.contains("잔차"));
        assert!(reply.followups.is_empty());
        assert_eq!(reply.effort, "medium");
    }
}
