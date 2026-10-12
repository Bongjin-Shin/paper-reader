#![cfg(unix)]
use paper_vocabulary_lib::{
    claude::ClaudeClient, codex::ChatEvent, connection::AiProvider, db::Database,
};
use serde_json::{json, Value};
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    sync::{mpsc, Arc},
    time::Duration,
};
fn client(scenario: &str) -> (tempfile::TempDir, ClaudeClient) {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("runtime")).unwrap();
    let binary = dir.path().join("runtime/claude");
    fs::write(&binary, include_str!("fixtures/claude_cli.py")).unwrap();
    fs::set_permissions(binary, fs::Permissions::from_mode(0o700)).unwrap();
    fs::write(dir.path().join("scenario"), scenario).unwrap();
    let client = ClaudeClient::new(dir.path().into());
    (dir, client)
}
fn payload(chat: bool) -> Value {
    json!({"model":"sonnet","chatEffort":"","paperChat":chat,"instructions":"논문 연구 도우미. 도구를 사용하지 마세요.","input":"논문 본문과 질문"})
}
fn browser_helper(dir: &std::path::Path) -> std::path::PathBuf {
    let path = dir.join("browser-capture");
    fs::write(&path, "#!/usr/bin/python3\nimport os,sys\nfrom pathlib import Path\np=Path(os.environ['PAPER_VOCABULARY_CLAUDE_LOGIN_URL_FILE'])\nt=p.with_suffix('.tmp')\nt.write_text(sys.argv[1])\nt.replace(p)\n").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
    path
}
#[test]
fn models_and_streaming_translation_use_isolated_tool_free_subscription_runtime() {
    let (dir, client) = client("translation");
    assert!(client.status().connected);
    let models = client.models().unwrap();
    assert!(models[0].is_default);
    assert!(models[3].efforts.is_empty());
    assert_eq!(models[2].model, "opus[1m]");
    let mut chunks = String::new();
    let result = client
        .lookup_stream(payload(false), |s| chunks.push_str(s))
        .unwrap();
    assert_eq!(result.provider, AiProvider::Claude);
    assert_eq!(chunks, result.text);
    assert_eq!(
        serde_json::from_str::<Value>(&result.text).unwrap()["sentences"][0]["translation"],
        "문장 번역"
    );
    assert_eq!(result.usage.input, 60);
    assert_eq!(result.usage.output, 8);
    let args: Vec<String> =
        serde_json::from_str(&fs::read_to_string(dir.path().join("launch.json")).unwrap()).unwrap();
    assert_eq!(
        args[args.iter().position(|v| v == "--effort").unwrap() + 1],
        "low"
    );
    assert_eq!(
        fs::metadata(dir.path().join("config"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    let db = Database::open(&dir.path().join("data.db")).unwrap();
    db.record_usage(&result).unwrap();
    assert_eq!(db.usage_summary().unwrap().total_cost_usd, 0.0);
}
#[test]
fn api_credentials_and_signed_out_sessions_never_fall_back_to_paid_api() {
    for scenario in ["api", "signed-out"] {
        let (dir, client) = client(scenario);
        assert!(!client.status().connected);
        assert!(client
            .lookup(payload(false))
            .unwrap_err()
            .contains("로그인"));
        assert!(!dir.path().join("requests.jsonl").exists());
    }
}
#[test]
fn failures_tools_and_disconnect_are_not_saved_as_success() {
    for scenario in ["error", "tools", "tool_request", "disconnect"] {
        let (_, client) = client(scenario);
        assert!(client.lookup(payload(false)).is_err());
    }
}
#[test]
fn queued_followups_stream_once_and_stop_preserves_partial_answer() {
    for stop in [false, true] {
        let (_dir, client) = client(if stop { "stop" } else { "queue" });
        let client = Arc::new(client);
        let worker = client.clone();
        let (send, recv) = mpsc::channel();
        let task = std::thread::spawn(move || {
            worker
                .chat("active", payload(true), |e| {
                    if matches!(e, ChatEvent::Answer { .. }) {
                        let _ = send.send(());
                    }
                })
                .unwrap()
        });
        recv.recv_timeout(Duration::from_secs(5)).unwrap();
        client
            .control_chat(
                "active",
                if stop {
                    None
                } else {
                    Some("추가 설명".into())
                },
            )
            .unwrap();
        let answer = task.join().unwrap();
        assert_eq!(answer.interrupted, stop);
        assert_eq!(answer.model, "claude-sonnet-test");
        assert!(!client.is_chat("active"));
        assert!(client.control_chat("active", None).is_err());
        if stop {
            assert_eq!(answer.answer, "한국어 답변 [p. 1]");
        } else {
            assert_eq!(answer.followups, vec!["추가 설명"]);
            assert_eq!(answer.answer, "한국어 답변 [p. 1]\n\n한국어 답변 [p. 1]");
        }
    }
}
#[test]
fn unsupported_effort_is_rejected_before_inference_and_login_can_be_cancelled() {
    let (dir, client) = client("ok");
    let mut p = payload(true);
    p["model"] = json!("haiku");
    p["chatEffort"] = json!("high");
    assert!(client.lookup(p).unwrap_err().contains("effort"));
    assert!(!dir.path().join("requests.jsonl").exists());
    let helper = browser_helper(dir.path());
    let url = client.login(&helper).unwrap();
    assert!(url.starts_with("https://claude.com/cai/oauth/authorize?"));
    assert_eq!(client.login(&helper).unwrap(), url);
    assert!(client.status().login_pending);
    client.cancel_login().unwrap();
    assert!(!client.status().login_pending);
    client.logout().unwrap();
    assert!(!client.status().connected);
}

#[test]
fn login_rejects_untrusted_url_and_reaps_pending_process() {
    let (dir, client) = client("bad-login-url");
    let helper = browser_helper(dir.path());
    assert!(client.login(&helper).is_err());
    assert!(!client.status().login_pending);
    assert!(fs::read_dir(dir.path().join("config"))
        .unwrap()
        .next()
        .is_none());
}

#[test]
fn claude_quota_is_read_without_inference_and_handles_partial_windows_and_logout() {
    let (dir, client) = client("ok");
    let usage = client.subscription_usage().unwrap();
    assert!(usage.updated_at.is_some());
    assert_eq!(usage.buckets.len(), 3);
    let primary = usage.buckets[0].primary.as_ref().unwrap();
    assert_eq!(primary.used_percent, 23.5);
    assert_eq!(primary.window_duration_mins, Some(300));
    assert_eq!(primary.resets_at, Some(1791460800));
    assert_eq!(
        usage.buckets[0].secondary.as_ref().unwrap().used_percent,
        40.0
    );
    assert_eq!(
        usage.buckets[1].secondary.as_ref().unwrap().used_percent,
        0.0
    );
    assert_eq!(
        usage.buckets[2].secondary.as_ref().unwrap().resets_at,
        primary.resets_at
    );
    assert!(!dir.path().join("requests.jsonl").exists());
    assert!(dir.path().join("usage-requested").exists());
    fs::write(dir.path().join("scenario"), "quota-error").unwrap();
    assert!(client.subscription_usage().is_err());
    client.logout().unwrap();
    assert!(client.subscription_usage().unwrap().buckets.is_empty());
}
#[test]
fn provider_settings_migrate_preserve_gpt_and_remain_independent_after_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db");
    {
        let db = Database::open(&path).unwrap();
        db.set_model_preference("translation", "gpt-test", "medium")
            .unwrap();
        db.set_model_preference("chat", "gpt-chat", "high").unwrap();
    }
    let sql = rusqlite::Connection::open(&path).unwrap();
    sql.execute_batch("CREATE TABLE old_preferences AS SELECT id,provider,translation_model,chat_model,chat_effort,translation_effort FROM ai_preferences; DROP TABLE ai_preferences; ALTER TABLE old_preferences RENAME TO ai_preferences; DROP TABLE claude_preferences; PRAGMA user_version=14;").unwrap();
    drop(sql);
    {
        let db = Database::open(&path).unwrap();
        assert_eq!(db.chat_provider().unwrap(), AiProvider::Chatgpt);
        db.set_ai_provider(AiProvider::Claude).unwrap();
        db.set_chat_provider(AiProvider::Claude).unwrap();
        db.set_provider_model_preference(AiProvider::Claude, "translation", "sonnet", "low")
            .unwrap();
        db.set_provider_model_preference(AiProvider::Claude, "chat", "opus[1m]", "max")
            .unwrap();
        assert!(db.set_chat_provider(AiProvider::Api).is_err());
    }
    let db = Database::open(&path).unwrap();
    assert_eq!(db.ai_provider().unwrap(), AiProvider::Claude);
    assert_eq!(db.chat_provider().unwrap(), AiProvider::Claude);
    let gpt = db.model_preferences().unwrap();
    assert_eq!(gpt.translation_model, "gpt-test");
    assert_eq!(gpt.chat_effort, "high");
    let claude = db.provider_preferences(AiProvider::Claude).unwrap();
    assert_eq!(claude.chat_model, "opus[1m]");
    assert_eq!(claude.translation_effort, "low");
}

#[test]
#[ignore = "read-only initialization of installed official Claude CLI; no login or inference"]
fn installed_claude_runtime_initializes_without_inference() {
    let dir = tempfile::tempdir().unwrap();
    let client = ClaudeClient::new(dir.path().into());
    let models = client.models().unwrap();
    assert!(!models.is_empty());
    assert!(models.iter().any(|m| m.is_default));
    assert!(!client.status().connected);
    assert!(client.subscription_usage().unwrap().buckets.is_empty());
}

#[tokio::test]
#[ignore = "downloads the pinned official helper and initializes it; no login or inference"]
async fn official_helper_download_verifies_and_starts() {
    let dir = tempfile::tempdir().unwrap();
    let client = ClaudeClient::new(dir.path().into());
    client.install().await.unwrap();
    assert!(dir.path().join("runtime/claude").is_file());
    assert!(!client.models().unwrap().is_empty());
    client.install().await.unwrap(); // Existing verified binary is reused.
}

#[test]
fn shutdown_reaps_active_claude_inference() {
    let (_dir, client) = client("stop");
    let client = Arc::new(client);
    let worker = client.clone();
    let (send, recv) = mpsc::channel();
    let task = std::thread::spawn(move || {
        worker.chat("active", payload(true), |e| {
            if matches!(e, ChatEvent::Answer { .. }) {
                let _ = send.send(());
            }
        })
    });
    recv.recv_timeout(Duration::from_secs(5)).unwrap();
    client.shutdown();
    assert!(task.join().unwrap().is_err());
    assert!(!client.is_chat("active"));
}

#[test]
fn translation_cancellation_drops_cli_before_its_result_and_can_restart() {
    use paper_vocabulary_lib::cancellation::Cancellation;
    let (dir, client) = client("stop"); let cancel=Cancellation::default();
    let result=client.lookup_stream_cancellable(payload(false),cancel.clone(),|_|cancel.cancel());
    assert_eq!(result.unwrap_err(),paper_vocabulary_lib::cancellation::CANCELLED);
    fs::write(dir.path().join("scenario"),"translation").unwrap();
    assert!(client.lookup(payload(false)).is_ok());
}
