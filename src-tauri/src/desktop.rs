use crate::{
    ai, claude, codex,
    connection::AiProvider,
    db::Database,
    history,
    library::{self, Library, LibraryDeletion, LibraryFolder, PaperMetadata},
    models::{
        Highlight, HighlightColor, LookupRequest, LookupResult, Paper, SavedHighlight,
        TextLookupRequest, VocabularyEntry,
    },
    papers,
    usage::UsageSummary,
};
use std::{fs, path::PathBuf, sync::Mutex, time::Duration};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

struct AppState {
    db: Mutex<Database>,
    papers_dir: PathBuf,
    client: reqwest::Client,
    api_key: String,
    codex: codex::CodexClient,
    claude: claude::ClaudeClient,
    dropped_paths: Mutex<Option<Vec<PathBuf>>>,
    translation_jobs: crate::cancellation::TranslationJobs,
}

#[tauri::command]
fn get_ai_provider(state: State<'_, AppState>) -> Result<AiProvider, String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류")?
        .ai_provider()
}

#[tauri::command]
fn set_ai_provider(state: State<'_, AppState>, provider: AiProvider) -> Result<(), String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류")?
        .set_ai_provider(provider)
}

#[tauri::command]
fn get_model_preferences(
    state: State<'_, AppState>,
    provider: Option<AiProvider>,
) -> Result<crate::connection::ModelPreferences, String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류")?
        .provider_preferences(provider.unwrap_or(AiProvider::Chatgpt))
}
#[tauri::command]
fn set_model_preference(
    state: State<'_, AppState>,
    scope: String,
    model: String,
    effort: String,
    provider: Option<AiProvider>,
) -> Result<(), String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류")?
        .set_provider_model_preference(
            provider.unwrap_or(AiProvider::Chatgpt),
            &scope,
            &model,
            &effort,
        )
}
#[tauri::command]
async fn get_chatgpt_models(app: tauri::AppHandle) -> Result<Vec<codex::ModelInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().codex.models())
        .await
        .map_err(|_| "모델 목록 오류")?
}
#[tauri::command]
fn get_chat_provider(state: State<'_, AppState>) -> Result<AiProvider, String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류")?
        .chat_provider()
}
#[tauri::command]
fn set_chat_provider(state: State<'_, AppState>, provider: AiProvider) -> Result<(), String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류")?
        .set_chat_provider(provider)
}
#[tauri::command]
async fn get_claude_status(app: tauri::AppHandle) -> Result<codex::ConnectionStatus, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().claude.status())
        .await
        .map_err(|_| "Claude 연결 확인 실패".into())
}
#[tauri::command]
async fn start_claude_login(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let helper = crate::browser::helper_executable()?;
        let url = state.claude.login(&helper)?;
        if let Err(error) = crate::browser::open_default_browser(&url) {
            let _ = state.claude.cancel_login();
            return Err(error);
        }
        Ok(())
    })
    .await
    .map_err(|_| "Claude 로그인 실패")?
}
#[tauri::command]
async fn cancel_claude_login(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().claude.cancel_login())
        .await
        .map_err(|_| "Claude 로그인 취소 실패")?
}
#[tauri::command]
async fn logout_claude(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().claude.logout())
        .await
        .map_err(|_| "Claude 로그아웃 실패")?
}
#[tauri::command]
async fn install_claude(state: State<'_, AppState>) -> Result<(), String> {
    state.claude.install().await
}
#[tauri::command]
async fn get_claude_models(app: tauri::AppHandle) -> Result<Vec<codex::ModelInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().claude.models())
        .await
        .map_err(|_| "Claude 모델 목록 오류")?
}
#[tauri::command]
fn get_paper_chat(
    state: State<'_, AppState>,
    paper_id: String,
) -> Result<Vec<crate::chat::ChatExchange>, String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류")?
        .paper_chat(&paper_id)
}
#[tauri::command]
async fn ask_paper(
    app: tauri::AppHandle,
    request: crate::chat::ChatRequest,
    request_id: String,
    edit: Option<crate::chat::ChatEdit>,
    on_progress: tauri::ipc::Channel<codex::ChatEvent>,
) -> Result<crate::chat::ChatExchange, String> {
    request.validate()?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let (provider, preferences, plan) = {
            let db = state.db.lock().map_err(|_| "데이터베이스 잠금 오류")?;
            let provider = db.chat_provider()?;
            (
                provider,
                db.provider_preferences(provider)?,
                db.prepare_chat(&request, edit.as_ref())?,
            )
        };
        let progress = |event| { let _ = on_progress.send(event); };
        let mut memory = state.db.lock().map_err(|_| "데이터베이스 잠금 오류")?
            .chat_memory(&request.paper_id, &plan.history)?;
        let mut summary_failed = false;
        // No database lock is held across model calls. Failed summaries never discard chat.
        while let Some(work) = crate::chat_memory::summary_work(&plan.history, memory.as_ref()) {
            progress(codex::ChatEvent::Context { message: "이전 대화를 요약해 문맥을 정리하는 중…".into() });
            let payload = work.payload(&preferences.chat_model);
            let result = if provider == AiProvider::Claude { state.claude.lookup(payload) } else { state.codex.lookup(payload) };
            match result.and_then(|result|work.accept(&result.text)) {
                Ok(next) => {
                    // The summary is a disposable cache; a cache write failure must not lose an answer.
                    if let Ok(db) = state.db.lock() { let _ = db.save_chat_memory(&request.paper_id, &next); }
                    memory = Some(next);
                }
                Err(_) => { summary_failed = true; break; }
            }
        }
        let (_, omitted) = crate::chat_memory::history_input(&plan.history, memory.as_ref());
        if summary_failed || omitted {
            progress(codex::ChatEvent::Context { message: "일부 긴 대화는 이번 답변의 문맥에서 생략됩니다. 저장된 원본 기록은 유지됩니다.".into() });
        } else if memory.is_some() {
            progress(codex::ChatEvent::Context { message: "이전 대화 요약과 최근 대화 원문을 함께 참고합니다.".into() });
        }
        let payload = plan.payload_with_memory(&request, &preferences.chat_model, &preferences.chat_effort, memory.as_ref());
        let answer = if provider == AiProvider::Claude {
            state.claude.chat(&request_id, payload, progress)?
        } else {
            state.codex.chat(&request_id, payload, progress)?
        };
        let result = state
            .db
            .lock()
            .map_err(|_| "데이터베이스 잠금 오류")?
            .save_chat_plan(&plan, &answer);
        result
    })
    .await
    .map_err(|_| "논문 채팅 작업 오류")?
}

#[tauri::command]
fn select_chat_branch(
    state: State<'_, AppState>,
    paper_id: String,
    exchange_id: i64,
) -> Result<Vec<crate::chat::ChatExchange>, String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류")?
        .select_chat_branch(&paper_id, exchange_id)
}

#[tauri::command]
async fn get_subscription_usage(app: tauri::AppHandle) -> Result<codex::SubscriptionUsage, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().codex.subscription_usage())
        .await
        .map_err(|_| "사용 한도 조회 오류")?
}
#[tauri::command]
async fn get_claude_subscription_usage(
    app: tauri::AppHandle,
) -> Result<codex::SubscriptionUsage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>().claude.subscription_usage()
    })
    .await
    .map_err(|_| "Claude 사용 한도 조회 오류")?
}
#[tauri::command]
async fn steer_paper_chat(
    app: tauri::AppHandle,
    request_id: String,
    question: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        if state.claude.is_chat(&request_id) {
            state.claude.control_chat(&request_id, Some(question))
        } else {
            state.codex.control_chat(&request_id, Some(question))
        }
    })
    .await
    .map_err(|_| "추가 질문 처리 오류")?
}
#[tauri::command]
async fn stop_paper_chat(app: tauri::AppHandle, request_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        if state.claude.is_chat(&request_id) {
            state.claude.control_chat(&request_id, None)
        } else {
            state.codex.control_chat(&request_id, None)
        }
    })
    .await
    .map_err(|_| "답변 중단 오류")?
}

#[tauri::command]
async fn get_chatgpt_status(app: tauri::AppHandle) -> Result<codex::ConnectionStatus, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().codex.status())
        .await
        .map_err(|_| "ChatGPT 연결 상태를 확인하지 못했습니다.".into())
}

#[tauri::command]
async fn start_chatgpt_login(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let url = app.state::<AppState>().codex.login()?;
        codex::validate_login_url(&url)?;
        #[cfg(target_os = "linux")]
        let mut command = std::process::Command::new("xdg-open");
        #[cfg(target_os = "macos")]
        let mut command = std::process::Command::new("open");
        #[cfg(target_os = "windows")]
        let mut command = {
            let mut cmd = std::process::Command::new("rundll32");
            cmd.arg("url.dll,FileProtocolHandler");
            cmd
        };
        command
            .arg(url)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map(|mut child| {
                std::thread::spawn(move || {
                    let _ = child.wait();
                });
            })
            .map_err(|_| {
                "로그인 브라우저를 열지 못했습니다. 기본 브라우저를 확인하고 다시 눌러 주세요."
                    .to_string()
            })
    })
    .await
    .map_err(|_| "ChatGPT 로그인을 시작하지 못했습니다.")?
}

#[tauri::command]
async fn cancel_chatgpt_login(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().codex.cancel_login())
        .await
        .map_err(|_| "ChatGPT 로그인을 취소하지 못했습니다.")?
}

#[tauri::command]
async fn logout_chatgpt(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().codex.logout())
        .await
        .map_err(|_| "ChatGPT 로그아웃에 실패했습니다.")?
}

async fn fetch_lookup(
    app: tauri::AppHandle,
    mut payload: serde_json::Value,
    provider: AiProvider,
) -> Result<crate::usage::AiResult, String> {
    let preferences = app
        .state::<AppState>()
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류")?
        .provider_preferences(provider)?;
    payload["model"] = serde_json::json!(preferences.translation_model);
    payload["chatEffort"] = serde_json::json!(preferences.translation_effort);
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        if provider == AiProvider::Claude {
            state.claude.lookup(payload)
        } else {
            state.codex.lookup(payload)
        }
    })
    .await
    .map_err(|_| "ChatGPT 번역 작업에 실패했습니다.")?
}

#[tauri::command]
async fn open_dropped_pdf(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<papers::PaperImportBatch, String> {
    import_dropped(app, paths, None).await
}

#[tauri::command]
async fn import_dropped_library_pdf(
    app: tauri::AppHandle,
    paths: Vec<String>,
    folder_id: Option<i64>,
) -> Result<papers::PaperImportBatch, String> {
    import_dropped(app, paths, Some(folder_id)).await
}

async fn import_dropped(
    app: tauri::AppHandle,
    paths: Vec<String>,
    folder: Option<Option<i64>>,
) -> Result<papers::PaperImportBatch, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let approved = state
            .dropped_paths
            .lock()
            .map_err(|_| "파일 선택 잠금 오류".to_string())?
            .take();
        let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        if approved.as_ref() != Some(&paths) {
            return Err("앱 창에 PDF를 다시 놓아 주세요.".into());
        }
        let mut db = state
            .db
            .lock()
            .map_err(|_| "데이터베이스 잠금 오류".to_string())?;
        let result = papers::import_pdfs(&paths, &state.papers_dir, &db, folder)?;
        if !result.papers.is_empty() {
            db.clear_redo();
        }
        Ok(result)
    })
    .await
    .map_err(|_| "PDF 열기 작업에 실패했습니다.".to_string())?
}

#[tauri::command]
fn get_api_usage(state: State<'_, AppState>) -> Result<UsageSummary, String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류".to_string())?
        .usage_summary()
}

#[tauri::command]
fn set_initial_credit(state: State<'_, AppState>, usd: String) -> Result<UsageSummary, String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류".to_string())?
        .set_initial_credit(&usd)
}

#[tauri::command]
fn get_page_translation(
    state: State<'_, AppState>,
    paper_id: String,
    page_number: u32,
) -> Result<Option<crate::page_translation::PageTranslation>, String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류")?
        .page_translation(&paper_id, page_number)
}

#[tauri::command]
fn begin_page_translation(state: State<'_, AppState>) -> Result<String, String> { state.translation_jobs.begin() }
#[tauri::command]
fn cancel_page_translation(state: State<'_, AppState>, request_id: String) -> Result<(), String> { state.translation_jobs.cancel(&request_id) }

#[tauri::command]
async fn translate_page(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: crate::page_translation::PageTranslationRequest,
    request_id: String,
    on_progress: tauri::ipc::Channel<Vec<crate::page_translation::SentenceOutput>>,
) -> Result<crate::page_translation::PageTranslation, String> {
    let cancellation = state.translation_jobs.get(&request_id)?;
    let provider = state.db.lock().map_err(|_| "데이터베이스 잠금 오류")?.ai_provider()?;
    let preferences = state.db.lock().map_err(|_| "데이터베이스 잠금 오류")?.provider_preferences(provider)?;
    let state = &*state;
    let stream_channel = on_progress.clone();
    let result = crate::page_translation::translate_page_cancellable(&state.db, &request, |batch, ids| {
        let cancellation = cancellation.clone();
        let app = app.clone();
        let on_progress = stream_channel.clone();
        let preferences = preferences.clone();
        async move {
            let count = batch.sentences.len();
            let mut stream = crate::page_translation::SentenceStream::default();
            let progress = move |delta: &str| {
                let rows: Vec<_> = stream.push(delta, count).into_iter().filter_map(|mut row| {
                    let id = ids.get(row.id as usize).copied().flatten()?;
                    row.id = id; Some(row)
                }).collect();
                if !rows.is_empty() { let _ = on_progress.send(rows); }
            };
            match provider {
                AiProvider::Api => cancellation.run(ai::translate_page_stream(&state.client, &state.api_key, &batch, progress)).await,
                AiProvider::Chatgpt | AiProvider::Claude => {
                    let mut payload = crate::page_translation::request_body(&batch);
                    payload["model"] = serde_json::json!(preferences.translation_model);
                    payload["chatEffort"] = serde_json::json!(preferences.translation_effort);
                    tauri::async_runtime::spawn_blocking(move || {
                        let state = app.state::<AppState>();
                        if provider == AiProvider::Claude { state.claude.lookup_stream_cancellable(payload, cancellation, progress) }
                        else { state.codex.lookup_stream_cancellable(payload, cancellation, progress) }
                    }).await.map_err(|_| "본문 번역 작업 오류")?
                }
            }
        }
    }, move |rows| { if !rows.is_empty() { let _ = on_progress.send(rows); } }, &cancellation).await;
    state.translation_jobs.finish(&request_id);
    result
}

#[tauri::command]
async fn lookup_text(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: TextLookupRequest,
) -> Result<LookupResult, String> {
    crate::lookup::lookup_text(&state.db, &request, || async {
        let provider = state
            .db
            .lock()
            .map_err(|_| "데이터베이스 잠금 오류")?
            .ai_provider()?;
        match provider {
            AiProvider::Api => ai::lookup_text(&state.client, &state.api_key, &request).await,
            AiProvider::Chatgpt | AiProvider::Claude => {
                fetch_lookup(app, ai::text_request_body(&request), provider).await
            }
        }
    })
    .await
}

#[tauri::command]
fn get_highlight_color(state: State<'_, AppState>) -> Result<HighlightColor, String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류".to_string())?
        .highlight_color()
}

#[tauri::command]
fn set_highlight_color(state: State<'_, AppState>, color: HighlightColor) -> Result<(), String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류".to_string())?
        .set_highlight_color(color)
}

#[tauri::command]
fn remove_highlights(
    state: State<'_, AppState>,
    paper_id: String,
    ids: Vec<i64>,
) -> Result<Vec<i64>, String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류".to_string())?
        .record("하이라이트 삭제", history::HIGHLIGHTS, |db| {
            db.remove_highlights(&paper_id, &ids)
        })
}

#[tauri::command]
async fn export_vocabulary_pdf(
    app: tauri::AppHandle,
    bytes: Vec<u8>,
    mode: String,
) -> Result<Option<String>, String> {
    if !matches!(mode.as_str(), "simple" | "detailed")
        || !bytes.starts_with(b"%PDF-")
        || bytes.len() > 64 * 1024 * 1024
    {
        return Err("내보낼 PDF 데이터가 올바르지 않습니다.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let directory = app
            .path()
            .app_local_data_dir()
            .map_err(|_| "저장 폴더를 찾지 못했습니다.")?
            .join("PaperVocabulary/exports");
        let selected = app
            .dialog()
            .file()
            .add_filter("PDF", &["pdf"])
            .set_directory(directory)
            .set_file_name(format!("vocabulary_{mode}.pdf"))
            .blocking_save_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let mut path = selected
            .into_path()
            .map_err(|_| "로컬 저장 위치를 선택해 주세요.")?;
        if path.extension().is_none() {
            path.set_extension("pdf");
        }
        if !path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
        {
            return Err("PDF 확장자로 저장해 주세요.".into());
        }
        fs::write(&path, bytes)
            .map_err(|_| "PDF 파일을 저장하지 못했습니다. 저장 위치를 확인해 주세요.")?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|_| "PDF 저장 작업에 실패했습니다.".to_string())?
}

#[tauri::command]
async fn open_pdf(app: tauri::AppHandle) -> Result<Option<papers::PaperImportBatch>, String> {
    pick_pdf(app, None).await
}

#[tauri::command]
async fn import_library_pdf(
    app: tauri::AppHandle,
    folder_id: Option<i64>,
) -> Result<Option<papers::PaperImportBatch>, String> {
    pick_pdf(app, Some(folder_id)).await
}

async fn pick_pdf(
    app: tauri::AppHandle,
    folder: Option<Option<i64>>,
) -> Result<Option<papers::PaperImportBatch>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .add_filter("PDF", &["pdf"])
            .blocking_pick_files();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let paths = selected
            .into_iter()
            .map(|file| {
                file.into_path()
                    .map_err(|_| "로컬 PDF 파일을 선택해 주세요.".to_string())
            })
            .collect::<Result<Vec<_>, _>>()?;
        let state = app.state::<AppState>();
        let mut db = state
            .db
            .lock()
            .map_err(|_| "데이터베이스 잠금 오류".to_string())?;
        let result = papers::import_pdfs(&paths, &state.papers_dir, &db, folder)?;
        if !result.papers.is_empty() {
            db.clear_redo();
        }
        Ok(Some(result))
    })
    .await
    .map_err(|_| "PDF 열기 작업에 실패했습니다.".to_string())?
}

#[tauri::command]
async fn read_pdf(app: tauri::AppHandle, paper_id: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let path = state
            .db
            .lock()
            .map_err(|_| "데이터베이스 잠금 오류".to_string())?
            .paper_path(&paper_id)?;
        fs::read(path)
            .map(tauri::ipc::Response::new)
            .map_err(|_| "저장된 PDF를 읽지 못했습니다.".into())
    })
    .await
    .map_err(|_| "PDF 읽기 작업에 실패했습니다.".to_string())?
}

#[tauri::command]
fn get_highlights(state: State<'_, AppState>, paper_id: String) -> Result<Vec<Highlight>, String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류".to_string())?
        .highlights(&paper_id)
}

#[tauri::command]
async fn lookup_word(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: LookupRequest,
) -> Result<LookupResult, String> {
    crate::lookup::lookup_word(&state.db, &request, || async {
        let provider = state
            .db
            .lock()
            .map_err(|_| "데이터베이스 잠금 오류")?
            .ai_provider()?;
        match provider {
            AiProvider::Api => ai::lookup(&state.client, &state.api_key, &request).await,
            AiProvider::Chatgpt | AiProvider::Claude => {
                fetch_lookup(app, ai::request_body(&request), provider).await
            }
        }
    })
    .await
}

#[tauri::command]
fn get_vocabulary(
    state: State<'_, AppState>,
    query: String,
    paper_id: Option<String>,
) -> Result<Vec<VocabularyEntry>, String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류".to_string())?
        .vocabulary(&query, paper_id.as_deref())
}

#[tauri::command]
fn delete_vocabulary(state: State<'_, AppState>, ids: Vec<i64>) -> Result<Vec<i64>, String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류".to_string())?
        .record("Vocabulary 삭제", history::VOCABULARY, |db| {
            db.delete_vocabulary(&ids)
        })
}

#[tauri::command]
fn get_papers(state: State<'_, AppState>) -> Result<Vec<Paper>, String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류".to_string())?
        .papers()
}

#[tauri::command]
fn get_library(state: State<'_, AppState>) -> Result<Library, String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류")?
        .library()
}

#[tauri::command]
fn create_library_folder(
    state: State<'_, AppState>,
    parent_id: Option<i64>,
    name: String,
) -> Result<LibraryFolder, String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류")?
        .record("폴더 생성", history::LIBRARY, |db| {
            db.create_library_folder(parent_id, &name)
        })
}

#[tauri::command]
fn rename_library_folder(
    state: State<'_, AppState>,
    folder_id: i64,
    name: String,
) -> Result<(), String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류")?
        .record("폴더 이름 변경", history::LIBRARY, |db| {
            db.rename_library_folder(folder_id, &name)
        })
}

#[tauri::command]
fn move_library_folder(
    state: State<'_, AppState>,
    folder_id: i64,
    parent_id: Option<i64>,
) -> Result<(), String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류")?
        .record("폴더 이동", history::LIBRARY, |db| {
            db.move_library_folder(folder_id, parent_id)
        })
}

#[tauri::command]
fn rename_library_paper(
    state: State<'_, AppState>,
    paper_id: String,
    title: String,
) -> Result<Paper, String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류")?
        .record("논문 이름 변경", history::LIBRARY, |db| {
            db.rename_library_paper(&paper_id, &title)
        })
}

#[tauri::command]
fn move_library_paper(
    state: State<'_, AppState>,
    paper_id: String,
    folder_id: Option<i64>,
) -> Result<(), String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류")?
        .record("논문 이동", history::LIBRARY, |db| {
            db.move_library_paper(&paper_id, folder_id)
        })
}

#[tauri::command]
fn move_library_papers(
    state: State<'_, AppState>,
    paper_ids: Vec<String>,
    folder_id: Option<i64>,
) -> Result<(), String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류")?
        .record("논문 일괄 이동", history::LIBRARY, |db| {
            db.move_library_papers(&paper_ids, folder_id)
        })
}

#[tauri::command]
async fn delete_library_papers(
    app: tauri::AppHandle,
    paper_ids: Vec<String>,
) -> Result<LibraryDeletion, String> {
    delete_library_items(app, Some(paper_ids), None).await
}

#[tauri::command]
fn update_paper_metadata(
    state: State<'_, AppState>,
    paper_id: String,
    metadata: PaperMetadata,
    automatic: bool,
) -> Result<Paper, String> {
    let mut db = state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류".to_string())?;
    if automatic {
        db.update_paper_metadata(&paper_id, &metadata, true)
    } else {
        db.record("논문 정보 수정", history::LIBRARY, |db| {
            db.update_paper_metadata(&paper_id, &metadata, false)
        })
    }
}

#[tauri::command]
fn set_paper_importance(
    state: State<'_, AppState>,
    paper_id: String,
    importance: u8,
) -> Result<(), String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류".to_string())?
        .record("중요도 변경", history::LIBRARY, |db| {
            db.set_paper_importance(&paper_id, importance)
        })
}

#[tauri::command]
fn set_paper_memo(
    state: State<'_, AppState>,
    paper_id: String,
    memo: String,
) -> Result<(), String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류".to_string())?
        .record("메모 수정", history::LIBRARY, |db| {
            db.set_paper_memo(&paper_id, &memo)
        })
}

#[tauri::command]
async fn delete_library_paper(
    app: tauri::AppHandle,
    paper_id: String,
) -> Result<LibraryDeletion, String> {
    delete_library_items(app, Some(vec![paper_id]), None).await
}

#[tauri::command]
async fn delete_library_folder(
    app: tauri::AppHandle,
    folder_id: i64,
) -> Result<LibraryDeletion, String> {
    delete_library_items(app, None, Some(folder_id)).await
}

async fn delete_library_items(
    app: tauri::AppHandle,
    paper_ids: Option<Vec<String>>,
    folder_id: Option<i64>,
) -> Result<LibraryDeletion, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut db = state.db.lock().map_err(|_| "데이터베이스 잠금 오류")?;
        let paper_ids = if let Some(id) = folder_id {
            db.record("폴더 삭제", history::LIBRARY, |db| {
                db.delete_library_folder(id)
            })?
        } else {
            let ids = paper_ids.as_deref().ok_or("삭제할 논문을 선택해 주세요.")?;
            db.record("논문 삭제", history::LIBRARY, |db| {
                db.delete_library_papers(ids)
            })?
        };
        let cleanup_pending = library::cleanup_deleted_pdfs(&db, &state.papers_dir).unwrap_or(true);
        Ok(LibraryDeletion {
            paper_ids,
            cleanup_pending,
        })
    })
    .await
    .map_err(|_| "Library 삭제 작업에 실패했습니다.".to_string())?
}

#[tauri::command]
fn get_saved_highlight(
    state: State<'_, AppState>,
    paper_id: String,
    highlight_id: i64,
) -> Result<SavedHighlight, String> {
    state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류".to_string())?
        .saved_highlight(&paper_id, highlight_id)
}

#[tauri::command]
fn get_history_state(state: State<'_, AppState>) -> Result<history::HistoryState, String> {
    Ok(state
        .db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류")?
        .history_state())
}

#[tauri::command]
async fn restore_history(app: tauri::AppHandle, redo: bool) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut db = state.db.lock().map_err(|_| "데이터베이스 잠금 오류")?;
        let label = db.restore_history(redo, &state.papers_dir)?;
        let _ = library::cleanup_deleted_pdfs(&db, &state.papers_dir);
        Ok(label)
    })
    .await
    .map_err(|_| "실행 취소 작업에 실패했습니다.".to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(target_os = "linux")]
            if let Some(window) = app.get_webview_window("main") {
                window.with_webview(|webview| {
                    use webkit2gtk::{InputMethodContextExt, SettingsExt, WebViewExt};
                    #[cfg(feature = "reader-profile")]
                    crate::native_profile::install(&webview.inner());
                    if let Some(input_context) = webview.inner().input_method_context() {
                        // Wry disables inline preedit on Linux. Restore it so IBus Hangul
                        // composes/deletes at the text caret instead of in an external popup.
                        input_context.set_enable_preedit(true);
                    }
                    if let Some(settings) = webview.inner().settings() {
                        // WebKitGTK otherwise keeps accelerating/catching up after wheel
                        // input stops, even when every PDF page is already rendered.
                        settings.set_enable_smooth_scrolling(false);
                    }
                })?;
            }
            #[cfg(target_os = "linux")]
            crate::uninstall::register_data_paths(&app.path().home_dir()?, &[
                app.path().app_local_data_dir()?,
                app.path().app_config_dir()?,
                app.path().app_cache_dir()?,
            ])?;
            let root = app.path().app_local_data_dir()?.join("PaperVocabulary");
            for directory in ["database", "papers", "cache", "exports"] {
                fs::create_dir_all(root.join(directory))?;
            }
            // Production: app-local .env; development: project .env. Never compiled into JS.
            let _ = dotenvy::from_path(root.join(".env"));
            #[cfg(debug_assertions)]
            let _ = dotenvy::from_path(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.env"));
            let db = Database::open(&root.join("database/vocabulary.db"))
                .map_err(std::io::Error::other)?;
            let _ = library::cleanup_deleted_pdfs(&db, &root.join("papers"));
            let bundled_runtime = app.path().resource_dir().ok().map(|path| path.join("runtime"));
            app.manage(AppState {
                db: Mutex::new(db),
                papers_dir: root.join("papers"),
                client: reqwest::Client::builder()
                    .connect_timeout(Duration::from_secs(10))
                    .timeout(Duration::from_secs(45))
                    .build()?,
                api_key: std::env::var("OPENAI_API_KEY").unwrap_or_default(),
                codex: codex::CodexClient::new(root.join("chatgpt"), codex::find_binary(&root.join("runtime"), bundled_runtime.as_deref())),
                claude: claude::ClaudeClient::new(root.join("claude")),
                dropped_paths: Mutex::new(None),
                translation_jobs: Default::default(),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(event) = event {
                let payload = match event {
                    tauri::DragDropEvent::Enter { paths, .. } if !paths.is_empty() => {
                        serde_json::json!({"type":"enter", "valid":papers::dropped_pdfs(paths).is_ok()})
                    }
                    tauri::DragDropEvent::Leave => serde_json::json!({"type":"leave"}),
                    tauri::DragDropEvent::Drop { paths, .. } => match papers::dropped_pdfs(paths) {
                        Ok(paths) => {
                            let state = window.state::<AppState>();
                            if let Ok(mut dropped) = state.dropped_paths.lock() { *dropped = Some(paths.clone()); }
                            serde_json::json!({"type":"drop", "paths":paths})
                        }
                        Err(error) => serde_json::json!({"type":"error", "message":error}),
                    },
                    _ => return,
                };
                let _ = window.emit("reader-file-drag", payload);
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_chat_provider, set_chat_provider, get_claude_status, start_claude_login, cancel_claude_login, logout_claude, install_claude, get_claude_models,
            get_model_preferences, set_model_preference, get_chatgpt_models, get_paper_chat, ask_paper, select_chat_branch, get_subscription_usage, get_claude_subscription_usage, steer_paper_chat, stop_paper_chat,
            get_ai_provider, set_ai_provider, get_chatgpt_status, start_chatgpt_login, cancel_chatgpt_login, logout_chatgpt,
            get_history_state, restore_history, open_pdf, get_page_translation, begin_page_translation, cancel_page_translation, translate_page,
            read_pdf,
            get_highlights,
            lookup_word
            , lookup_text, open_dropped_pdf, get_api_usage, set_initial_credit,
            get_vocabulary, get_papers, get_saved_highlight, get_highlight_color, set_highlight_color,
            remove_highlights, export_vocabulary_pdf, delete_vocabulary, crate::printing::print_vocabulary_pdf,
            get_library, create_library_folder, rename_library_folder, move_library_folder,
            rename_library_paper, move_library_paper, import_library_pdf, import_dropped_library_pdf,
            delete_library_paper, delete_library_folder, move_library_papers, delete_library_papers, update_paper_metadata, set_paper_importance, set_paper_memo
        ])
        .build(tauri::generate_context!())
        .expect("Paper Vocabulary 실행 실패")
        .run(|app, event| { if let tauri::RunEvent::Exit = event { app.state::<AppState>().codex.shutdown(); app.state::<AppState>().claude.shutdown(); } });
}
