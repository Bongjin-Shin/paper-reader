//! Claude subscription connection through the official Claude Code CLI.
//! Credentials stay in the CLI's app-local config directory. Never reads tokens/cookies.
use crate::{
    browser::{validate_claude_login_url, CLAUDE_LOGIN_URL_FILE},
    codex::{
        ChatEvent, ChatReply, ConnectionStatus, ModelInfo, QuotaBucket, QuotaWindow,
        SubscriptionUsage,
    },
    connection::AiProvider,
    usage::{AiResult, TokenUsage},
};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex, Weak,
    },
    time::{Duration, Instant},
};

const LIMIT: usize = 4_000_000;
const VERSION: &str = "2.1.241";
const DISCONNECTED: &str = "Claude 구독 로그인이 필요합니다. AI 연결에서 Claude에 로그인해 주세요. API로 자동 전환하지 않습니다.";
const SETTINGS: &str = r#"{"disableAllHooks":true,"autoMemoryEnabled":false,"permissions":{"deny":["*"]},"forceLoginMethod":"claudeai"}"#;

enum Control {
    Followup(String, mpsc::Sender<Result<(), String>>),
    Stop(mpsc::Sender<Result<(), String>>),
}
struct Live {
    id: String,
    sender: mpsc::Sender<Control>,
}
struct Login {
    child: Child,
    started: Instant,
    url_file: PathBuf,
    url: String,
}
impl Drop for Login {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = fs::remove_file(&self.url_file);
        let _ = fs::remove_file(self.url_file.with_extension("tmp"));
    }
}
pub struct ClaudeClient {
    directory: PathBuf,
    login: Mutex<Option<Login>>,
    live: Mutex<Option<Live>>,
    stopped: AtomicBool,
    installing: AtomicBool,
    children: Mutex<Vec<Weak<Mutex<Child>>>>,
}

impl ClaudeClient {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            login: Mutex::new(None),
            live: Mutex::new(None),
            stopped: AtomicBool::new(false),
            installing: AtomicBool::new(false),
            children: Mutex::new(Vec::new()),
        }
    }
    fn executable(&self) -> Option<PathBuf> {
        let name = if cfg!(windows) {
            "claude.exe"
        } else {
            "claude"
        };
        let mut paths = vec![self.directory.join("runtime").join(name)];
        for var in ["HOME", "USERPROFILE"] {
            if let Some(home) = std::env::var_os(var) {
                paths.push(PathBuf::from(home).join(".local/bin").join(name));
            }
        }
        if let Some(path) = std::env::var_os("PATH") {
            paths.extend(
                std::env::split_paths(&path)
                    .filter(|p| p.is_absolute())
                    .map(|p| p.join(name)),
            );
        }
        paths.into_iter().find(|p| p.is_file())
    }
    fn command(&self) -> Result<Command, String> {
        let binary = self
            .executable()
            .ok_or("Claude 연결 도구가 없습니다. AI 연결에서 연결 도구 설치를 눌러 주세요.")?;
        let config = self.directory.join("config");
        let work = self.directory.join("work");
        private_dir(&config)?;
        private_dir(&work)?;
        let mut cmd = Command::new(binary);
        cmd.env_clear();
        for key in [
            "HOME",
            "USERPROFILE",
            "PATH",
            "SystemRoot",
            "WINDIR",
            "APPDATA",
            "LOCALAPPDATA",
            "TEMP",
            "TMP",
            "TMPDIR",
            "LANG",
            "LC_ALL",
            "DISPLAY",
            "WAYLAND_DISPLAY",
            "XDG_RUNTIME_DIR",
            "DBUS_SESSION_BUS_ADDRESS",
            "HTTPS_PROXY",
            "HTTP_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "https_proxy",
            "http_proxy",
            "all_proxy",
            "no_proxy",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
        ] {
            if let Some(value) = std::env::var_os(key) {
                cmd.env(key, value);
            }
        }
        cmd.env("CLAUDE_CONFIG_DIR", config)
            .env("DISABLE_AUTOUPDATER", "1")
            .env("CLAUDE_CODE_SKIP_PROMPT_HISTORY", "1")
            .current_dir(work)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        Ok(cmd)
    }
    pub fn status(&self) -> ConnectionStatus {
        let mut result = ConnectionStatus {
            installed: self.executable().is_some(),
            connected: false,
            plan_type: None,
            login_pending: false,
            error: None,
        };
        if !result.installed {
            return result;
        }
        if let Ok(mut guard) = self.login.lock() {
            if let Some(login) = guard.as_mut() {
                match login.child.try_wait() {
                    Ok(Some(status)) => {
                        if !status.success() {
                            result.error = Some(
                                "Claude 로그인을 완료하지 못했습니다. 다시 로그인해 주세요.".into(),
                            );
                        }
                        *guard = None;
                    }
                    Ok(None) if login.started.elapsed() < Duration::from_secs(600) => {
                        result.login_pending = true
                    }
                    _ => {
                        *guard = None;
                        result.error = Some("Claude 로그인 시간이 초과되었습니다.".into());
                    }
                }
            }
        }
        let status = self.command().and_then(|mut cmd| {
            cmd.args(["auth", "status"]);
            capture(cmd, Duration::from_secs(20))
        });
        match status {
            Ok(value) => {
                result.connected = value["loggedIn"] == true && value["authMethod"] == "claude.ai";
                result.plan_type = value["subscriptionType"].as_str().map(str::to_string);
                if value["loggedIn"] == true && !result.connected {
                    result.error = Some(DISCONNECTED.into());
                }
            }
            Err(error) => result.error = Some(error),
        }
        result
    }
    pub fn login(&self, browser_helper: &Path) -> Result<String, String> {
        let mut guard = self.login.lock().map_err(|_| "Claude 로그인 잠금 오류")?;
        if let Some(login) = guard.as_mut() {
            if login
                .child
                .try_wait()
                .map_err(|_| "Claude 로그인 상태 오류")?
                .is_none()
                && login.started.elapsed() < Duration::from_secs(600)
            {
                return Ok(login.url.clone());
            }
        }
        *guard = None;
        if !browser_helper.is_absolute() || !browser_helper.is_file() {
            return Err("Claude 로그인 브라우저 도우미를 찾지 못했습니다.".into());
        }
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "시스템 시각 오류")?
            .as_nanos();
        let url_file = self
            .directory
            .join("config")
            .join(format!("login-{}-{stamp}.url", std::process::id()));
        let child = self
            .command()?
            .args(["auth", "login", "--claudeai"])
            // The CLI prints a *manual* login URL to stdout. Capture the actual
            // BROWSER request instead so its localhost callback completes login.
            .env("BROWSER", browser_helper)
            .env(CLAUDE_LOGIN_URL_FILE, &url_file)
            // The browser capture helper may re-enter an AppImage on systems
            // without FUSE. This variable has no effect on the native CLI.
            .env("APPIMAGE_EXTRACT_AND_RUN", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .spawn()
            .map_err(|_| "Claude 로그인 브라우저를 열지 못했습니다.")?;
        let mut login = Login {
            child,
            started: Instant::now(),
            url_file,
            url: String::new(),
        };
        while login.started.elapsed() < Duration::from_secs(30) {
            if login.url_file.is_file() {
                let mut url = String::new();
                fs::File::open(&login.url_file)
                    .and_then(|file| file.take(16385).read_to_string(&mut url))
                    .map_err(|_| "Claude 로그인 주소 전달 실패")?;
                validate_claude_login_url(&url)?;
                let _ = fs::remove_file(&login.url_file);
                login.url = url.clone();
                *guard = Some(login);
                return Ok(url);
            }
            if login
                .child
                .try_wait()
                .map_err(|_| "Claude 로그인 상태 오류")?
                .is_some()
            {
                return Err("Claude 로그인을 시작하지 못했습니다. 연결 도구를 복구한 뒤 다시 시도해 주세요.".into());
            }
            std::thread::sleep(Duration::from_millis(30));
        }
        Err(
            "Claude 로그인 주소를 받지 못했습니다. 연결 도구를 복구한 뒤 다시 시도해 주세요."
                .into(),
        )
    }
    /// Official CLI's read-only /usage control request: no prompt or inference.
    pub fn subscription_usage(&self) -> Result<SubscriptionUsage, String> {
        let mut session = self.session("", "", "사용 한도 조회")?;
        session.initialize()?;
        session.send(json!({"type":"control_request","request_id":"quota","request":{"subtype":"get_usage"}}))?;
        let until = Instant::now() + Duration::from_secs(25);
        while Instant::now() < until {
            if let Some(value) = session.receive(Duration::from_millis(100))? {
                if value["type"] == "control_request" {
                    return Err(
                        "Claude 사용 한도 조회 중 예기치 않은 권한 요청이 발생했습니다.".into(),
                    );
                }
                if value["type"] == "control_response" && value["response"]["request_id"] == "quota"
                {
                    if value["response"]["subtype"] != "success" {
                        return Err("Claude 사용 한도를 조회하지 못했습니다. 연결 도구를 복구한 뒤 다시 시도해 주세요.".into());
                    }
                    return parse_subscription_usage(&value["response"]["response"]);
                }
            }
        }
        Err("Claude 사용 한도 조회 시간이 초과되었습니다.".into())
    }
    pub fn cancel_login(&self) -> Result<(), String> {
        *self.login.lock().map_err(|_| "Claude 로그인 잠금 오류")? = None;
        Ok(())
    }
    pub fn logout(&self) -> Result<(), String> {
        if self
            .live
            .lock()
            .map_err(|_| "Claude 채팅 잠금 오류")?
            .is_some()
        {
            return Err("Claude 답변을 중단한 뒤 로그아웃해 주세요.".into());
        }
        self.cancel_login()?;
        let mut cmd = self.command()?;
        cmd.args(["auth", "logout"]);
        let mut child = cmd
            .stdout(Stdio::null())
            .stdin(Stdio::null())
            .spawn()
            .map_err(|_| "Claude 로그아웃 실패")?;
        let until = Instant::now() + Duration::from_secs(20);
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    return if status.success() {
                        Ok(())
                    } else {
                        Err("Claude 로그아웃 실패".into())
                    }
                }
                Err(_) => break,
                _ if Instant::now() > until => break,
                _ => std::thread::sleep(Duration::from_millis(50)),
            }
        }
        let _ = child.kill();
        let _ = child.wait();
        Err("Claude 로그아웃 시간이 초과되었습니다.".into())
    }
    fn session(&self, model: &str, effort: &str, instructions: &str) -> Result<Session, String> {
        let mut cmd = self.command()?;
        cmd.args([
            "-p",
            "--safe-mode",
            "--tools",
            "",
            "--disallowedTools",
            "*",
            "--strict-mcp-config",
            "--mcp-config",
            r#"{"mcpServers":{}}"#,
            "--setting-sources",
            "",
            "--settings",
            SETTINGS,
            "--no-session-persistence",
            "--permission-mode",
            "dontAsk",
            "--disable-slash-commands",
            "--no-chrome",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--system-prompt",
            instructions,
        ]);
        if !model.is_empty() && model != "default" {
            cmd.args(["--model", model]);
        }
        if !effort.is_empty() {
            cmd.args(["--effort", effort]);
        }
        let session = Session::start(cmd)?;
        let mut children = self
            .children
            .lock()
            .map_err(|_| "Claude 프로세스 잠금 오류")?;
        if self.stopped.load(Ordering::Relaxed) {
            return Err("앱이 종료되어 Claude 연결을 중단했습니다.".into());
        }
        children.retain(|child| child.strong_count() > 0);
        children.push(Arc::downgrade(&session.child));
        Ok(session)
    }
    pub fn models(&self) -> Result<Vec<ModelInfo>, String> {
        let mut session = self.session(
            "",
            "",
            "Paper Vocabulary의 논문 번역·채팅 연결입니다. 도구를 사용하지 마세요.",
        )?;
        let response = session.initialize()?;
        let models = parse_models(&response);
        if models.is_empty() {
            return Err(
                "Claude 모델 목록을 읽지 못했습니다. 연결 도구를 설치하거나 업데이트해 주세요."
                    .into(),
            );
        }
        Ok(models)
    }
    pub fn is_chat(&self, id: &str) -> bool {
        self.live
            .lock()
            .ok()
            .is_some_and(|live| live.as_ref().is_some_and(|l| l.id == id))
    }
    pub fn control_chat(&self, id: &str, question: Option<String>) -> Result<(), String> {
        if question
            .as_ref()
            .is_some_and(|q| q.trim().is_empty() || q.chars().count() > 8000)
        {
            return Err("추가 질문은 1~8,000자로 입력해 주세요.".into());
        }
        let (send, recv) = mpsc::channel();
        {
            let guard = self.live.lock().map_err(|_| "Claude 채팅 잠금 오류")?;
            let live = guard
                .as_ref()
                .filter(|l| l.id == id)
                .ok_or("Claude 답변이 이미 종료되었습니다.")?;
            live.sender
                .send(match question {
                    Some(q) => Control::Followup(q.trim().into(), send),
                    None => Control::Stop(send),
                })
                .map_err(|_| "Claude 답변이 이미 종료되었습니다.")?;
        }
        recv.recv_timeout(Duration::from_secs(10))
            .map_err(|_| "Claude 답변이 이미 종료되었거나 추가 질문을 처리하지 못했습니다.")?
    }
    pub fn chat(
        &self,
        id: &str,
        payload: Value,
        mut progress: impl FnMut(ChatEvent),
    ) -> Result<ChatReply, String> {
        if id.is_empty() || id.len() > 100 {
            return Err("채팅 요청 번호가 올바르지 않습니다.".into());
        }
        let (sender, receiver) = mpsc::channel();
        {
            let mut guard = self.live.lock().map_err(|_| "Claude 채팅 잠금 오류")?;
            if guard.is_some() {
                return Err("진행 중인 Claude 답변을 먼저 완료하거나 중단해 주세요.".into());
            }
            *guard = Some(Live {
                id: id.into(),
                sender,
            });
        }
        let result = self.run(payload, Some(receiver), None, &mut progress);
        if let Ok(mut guard) = self.live.lock() {
            *guard = None;
        }
        result.map(|r| r.0)
    }
    pub fn lookup_stream(
        &self,
        payload: Value,
        mut progress: impl FnMut(&str),
    ) -> Result<AiResult, String> {
        let mut previous = String::new();
        let (_, result) = self.run(payload, None, None, &mut |event| {
            if let ChatEvent::Answer { text } = event {
                if let Some(delta) = text.strip_prefix(&previous) {
                    progress(delta);
                }
                previous = text;
            }
        })?;
        Ok(result)
    }
    pub fn lookup_stream_cancellable(&self, payload: Value, cancellation: crate::cancellation::Cancellation, mut progress: impl FnMut(&str)) -> Result<AiResult, String> {
        cancellation.check()?;
        let mut previous = String::new();
        let (_, result) = self.run(payload, None, Some(&cancellation), &mut |event| {
            if let ChatEvent::Answer { text } = event {
                if let Some(delta) = text.strip_prefix(&previous) { progress(delta); }
                previous = text;
            }
        })?;
        cancellation.check()?; Ok(result)
    }
    pub fn lookup(&self, payload: Value) -> Result<AiResult, String> {
        self.lookup_stream(payload, |_| {})
    }
    fn run(
        &self,
        payload: Value,
        controls: Option<mpsc::Receiver<Control>>,
        cancellation: Option<&crate::cancellation::Cancellation>,
        progress: &mut impl FnMut(ChatEvent),
    ) -> Result<(ChatReply, AiResult), String> {
        if !self.status().connected {
            return Err(DISCONNECTED.into());
        }
        let catalog = self.models()?;
        let requested = payload["model"].as_str().unwrap_or("");
        let selected = catalog
            .iter()
            .find(|m| m.model == requested)
            .or_else(|| {
                if requested.is_empty() {
                    catalog.iter().find(|m| m.is_default)
                } else {
                    None
                }
            })
            .ok_or("Claude 모델 목록에서 모델을 다시 선택해 주세요.")?;
        let wanted_effort = payload["chatEffort"].as_str().unwrap_or("");
        let effort = if wanted_effort.is_empty() {
            if payload["paperChat"] != true && selected.efforts.iter().any(|e| e == "low") {
                "low"
            } else {
                ""
            }
        } else if selected.efforts.iter().any(|e| e == wanted_effort) {
            wanted_effort
        } else {
            return Err("선택한 Claude 모델이 지원하는 effort를 다시 선택해 주세요.".into());
        };
        let mut session = self.session(
            &selected.model,
            effort,
            payload["instructions"]
                .as_str()
                .unwrap_or("한국어로 답변하세요. 도구를 사용하지 마세요."),
        )?;
        session.initialize()?;
        if let Some(cancel) = cancellation { cancel.check()?; }
        session.send(json!({"type":"user","message":{"role":"user","content":payload["input"].as_str().unwrap_or("")},"parent_tool_use_id":null}))?;
        progress(ChatEvent::Ready);
        let mut text = TextStream::default();
        let mut followups = Vec::new();
        let mut queued = std::collections::VecDeque::new();
        let mut actual_model = selected.model.clone();
        let mut interrupted = false;
        let initial = payload["initialFollowupCount"].as_u64().unwrap_or(0) as usize;
        let mut usage = TokenUsage {
            input: 0,
            cached_input: 0,
            cache_write: 0,
            output: 0,
            estimated: false,
        };
        let mut deadline = Instant::now() + Duration::from_secs(900);
        loop {
            if let Some(cancel) = cancellation { cancel.check()?; }
            if self.stopped.load(Ordering::Relaxed) {
                return Err("앱이 종료되어 Claude 요청을 중단했습니다.".into());
            }
            if let Some(ref receiver) = controls {
                while let Ok(control) = receiver.try_recv() {
                    match control {
                        Control::Stop(reply) => {
                            interrupted = true;
                            let _ = reply.send(Ok(()));
                            break;
                        }
                        Control::Followup(question, reply) => {
                            if initial + followups.len() >= 20 {
                                let _ = reply.send(Err(
                                    "추가 질문은 한 답변당 20개까지 보낼 수 있습니다.".into(),
                                ));
                                continue;
                            }
                            // Submit one followup per result so the CLI cannot merge queued questions.
                            queued.push_back(question.clone());
                            followups.push(question.clone());
                            progress(ChatEvent::Accepted { question });
                            let _ = reply.send(Ok(()));
                        }
                    }
                }
            }
            if interrupted {
                break;
            }
            if Instant::now() > deadline {
                return Err("Claude 응답 시간이 초과되었습니다. 다시 시도해 주세요.".into());
            }
            let Some(value) = session.receive(Duration::from_millis(40))? else {
                continue;
            };
            match value["type"].as_str() {
                Some("control_request") => {
                    return Err(
                        "Claude가 허용되지 않은 도구 또는 권한을 요청하여 중단했습니다.".into(),
                    )
                }
                Some("system") if value["subtype"] == "init" => {
                    if value["tools"].as_array().is_some_and(|a| !a.is_empty()) {
                        return Err(
                            "Claude 도구 차단 설정을 확인하지 못해 요청을 중단했습니다.".into()
                        );
                    }
                    if let Some(m) = value["model"].as_str() {
                        actual_model = m.into();
                    }
                }
                Some("stream_event") | Some("assistant") => {
                    if value["message"]["content"]
                        .as_array()
                        .is_some_and(|a| a.iter().any(|c| c["type"] == "tool_use"))
                        || value["event"]["content_block"]["type"] == "tool_use"
                    {
                        return Err("Claude가 도구 사용을 요청하여 중단했습니다.".into());
                    }
                    if let Some(m) = value["message"]["model"].as_str() {
                        actual_model = m.into();
                    }
                    if text.update(&value)? {
                        progress(ChatEvent::Answer { text: text.full() });
                    }
                    if value["event"]["delta"]["type"] == "thinking_delta" {
                        progress(ChatEvent::Thinking);
                    }
                }
                Some("result") => {
                    if value["is_error"] == true || value["subtype"] != "success" {
                        return Err(result_error(&value));
                    }
                    text.finish(value["result"].as_str().unwrap_or(""))?;
                    progress(ChatEvent::Answer { text: text.full() });
                    let u = &value["usage"];
                    // Claude usage counters separate cache reads/writes from fresh input.
                    let cached = u["cache_read_input_tokens"].as_i64().unwrap_or(0).max(0);
                    let write = u["cache_creation_input_tokens"]
                        .as_i64()
                        .unwrap_or(0)
                        .max(0);
                    usage.input += u["input_tokens"].as_i64().unwrap_or(0).max(0) + cached + write;
                    usage.cached_input += cached;
                    usage.cache_write += write;
                    usage.output += u["output_tokens"].as_i64().unwrap_or(0).max(0);
                    if let Some(question) = queued.pop_front() {
                        session.send(json!({"type":"user","message":{"role":"user","content":crate::chat::followup_input(&question)},"parent_tool_use_id":null}))?;
                        text.next();
                        deadline = Instant::now() + Duration::from_secs(900);
                    } else {
                        break;
                    }
                }
                _ => {}
            }
        }
        let answer = text.full();
        if answer.trim().is_empty() && !interrupted {
            return Err("Claude가 답변을 반환하지 않았습니다.".into());
        }
        let reply = ChatReply {
            answer: answer.clone(),
            model: actual_model,
            effort: effort.into(),
            followups,
            interrupted,
        };
        Ok((
            reply,
            AiResult {
                provider: AiProvider::Claude,
                text: answer,
                response_id: None,
                usage,
            },
        ))
    }
    pub fn shutdown(&self) {
        self.stopped.store(true, Ordering::Relaxed);
        if let Ok(mut children) = self.children.lock() {
            for child in children.drain(..).filter_map(|child| child.upgrade()) {
                if let Ok(mut child) = child.lock() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
        let _ = self.cancel_login();
    }
    pub async fn install(&self) -> Result<(), String> {
        if self.installing.swap(true, Ordering::SeqCst) {
            return Err("Claude 연결 도구를 설치하는 중입니다.".into());
        }
        let result = self.install_inner().await;
        self.installing.store(false, Ordering::SeqCst);
        result
    }
    async fn install_inner(&self) -> Result<(), String> {
        use sha2::{Digest, Sha256};
        let os = if cfg!(windows) {
            "win32"
        } else if cfg!(target_os = "macos") {
            "darwin"
        } else {
            "linux"
        };
        let arch = if cfg!(target_arch = "x86_64") {
            "x64"
        } else if cfg!(target_arch = "aarch64") {
            "arm64"
        } else {
            return Err("이 기기의 Claude 연결 도구는 지원하지 않습니다.".into());
        };
        let platform = format!("{os}-{arch}");
        let manifest: Value = serde_json::from_str(include_str!("../claude-runtime.json"))
            .map_err(|_| "Claude 배포 정보 오류")?;
        let row = &manifest["platforms"][&platform];
        let name = row["binary"].as_str().ok_or("Claude 실행 파일 정보 없음")?;
        let expected = row["checksum"].as_str().ok_or("Claude 검증 정보 없음")?;
        let size = row["size"].as_u64().ok_or("Claude 크기 정보 없음")?;
        let directory = self.directory.join("runtime");
        private_dir(&directory)?;
        let target = directory.join(name);
        if target.is_file() {
            let mut existing =
                fs::File::open(&target).map_err(|_| "Claude 연결 도구를 읽지 못했습니다.")?;
            let mut hash = Sha256::new();
            std::io::copy(&mut existing, &mut hash).map_err(|_| "Claude 연결 도구 검증 실패")?;
            if format!("{:x}", hash.finalize()) == expected {
                return Ok(());
            }
        }
        let temp = directory.join(format!("{name}.download"));
        let result: Result<(), String> = async {
            let client = reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(20))
                .timeout(Duration::from_secs(600))
                .build()
                .map_err(|_| "다운로드 연결 오류")?;
            let mut response = client
                .get(format!(
                    "https://downloads.claude.ai/claude-code-releases/{VERSION}/{platform}/{name}"
                ))
                .send()
                .await
                .map_err(|_| "Claude 연결 도구 다운로드 실패")?
                .error_for_status()
                .map_err(|_| "Claude 공식 다운로드에 연결하지 못했습니다.")?;
            let mut file = fs::File::create(&temp).map_err(|_| "Claude 연결 도구 저장 실패")?;
            let mut hash = Sha256::new();
            let mut received = 0u64;
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|_| "Claude 다운로드가 중단되었습니다.")?
            {
                received += chunk.len() as u64;
                if received > size {
                    return Err("Claude 다운로드 크기 검증 실패".into());
                }
                hash.update(&chunk);
                file.write_all(&chunk)
                    .map_err(|_| "Claude 연결 도구 저장 실패")?;
            }
            if received != size || format!("{:x}", hash.finalize()) != expected {
                return Err("Claude 연결 도구 무결성 검증 실패".into());
            }
            file.sync_all().map_err(|_| "Claude 연결 도구 저장 실패")?;
            drop(file);
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&temp, fs::Permissions::from_mode(0o700))
                    .map_err(|_| "실행 권한 설정 실패")?;
            }
            #[cfg(windows)]
            if target.exists() {
                fs::remove_file(&target)
                    .map_err(|_| "사용 중인 Claude 연결 도구를 닫고 다시 설치해 주세요.")?;
            }
            fs::rename(&temp, &target).map_err(|_| "Claude 연결 도구 설치 실패")?;
            Ok(())
        }
        .await;
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        result
    }
}
fn private_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|_| "Claude 연결 폴더를 만들지 못했습니다.")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Claude 폴더 권한 설정 실패")?;
    }
    Ok(())
}
fn capture(mut command: Command, timeout: Duration) -> Result<Value, String> {
    let mut child = command
        .stdin(Stdio::null())
        .spawn()
        .map_err(|_| "Claude 연결 도구를 실행하지 못했습니다.")?;
    let stdout = child.stdout.take().ok_or("Claude 응답 연결 실패")?;
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout
            .take(LIMIT as u64)
            .read_to_end(&mut bytes)
            .map(|_| bytes);
        let _ = sender.send(result);
    });
    let result = receiver
        .recv_timeout(timeout)
        .map_err(|_| "Claude 연결 확인 시간이 초과되었습니다.")
        .and_then(|r| r.map_err(|_| "Claude 연결 응답 오류"))
        .and_then(|bytes| {
            serde_json::from_slice(&bytes).map_err(|_| {
                "Claude 연결 응답을 읽지 못했습니다. 연결 도구를 설치하거나 업데이트해 주세요."
            })
        });
    let _ = child.kill();
    let _ = child.wait();
    result.map_err(str::to_string)
}
struct Session {
    child: Arc<Mutex<Child>>,
    input: ChildStdin,
    output: mpsc::Receiver<Result<Value, String>>,
}
impl Drop for Session {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
impl Session {
    fn start(mut command: Command) -> Result<Self, String> {
        let mut child = command
            .spawn()
            .map_err(|_| "Claude 연결 도구를 실행하지 못했습니다.")?;
        let input = child.stdin.take().ok_or("Claude 입력 연결 실패")?;
        let stdout = child.stdout.take().ok_or("Claude 출력 연결 실패")?;
        let (sender, output) = mpsc::sync_channel(64);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut bytes = Vec::new();
                let n = reader
                    .by_ref()
                    .take((LIMIT + 1) as u64)
                    .read_until(b'\n', &mut bytes);
                let event = match n {
                    Ok(0) => break,
                    Ok(_) if bytes.len() <= LIMIT => {
                        serde_json::from_slice(&bytes).map_err(|_| "Claude 응답 형식 오류".into())
                    }
                    _ => Err("Claude 응답이 너무 크거나 연결이 중단되었습니다.".into()),
                };
                let failed = event.is_err();
                if sender.send(event).is_err() || failed {
                    break;
                }
            }
        });
        Ok(Self {
            child: Arc::new(Mutex::new(child)),
            input,
            output,
        })
    }
    fn send(&mut self, value: Value) -> Result<(), String> {
        writeln!(self.input, "{value}")
            .and_then(|_| self.input.flush())
            .map_err(|_| "Claude 입력 연결이 끊어졌습니다.".into())
    }
    fn receive(&self, wait: Duration) -> Result<Option<Value>, String> {
        match self.output.recv_timeout(wait) {
            Ok(value) => value.map(Some),
            Err(mpsc::RecvTimeoutError::Timeout) => Ok(None),
            Err(_) => Err(
                "Claude 연결이 종료되었습니다. 로그인 상태와 연결 도구 버전을 확인해 주세요."
                    .into(),
            ),
        }
    }
    fn initialize(&mut self) -> Result<Value, String> {
        self.send(json!({"type":"control_request","request_id":"init","request":{"subtype":"initialize"}}))?;
        let until = Instant::now() + Duration::from_secs(30);
        while Instant::now() < until {
            if let Some(value) = self.receive(Duration::from_millis(100))? {
                if value["type"] == "control_request" {
                    return Err("Claude가 초기화 중 권한을 요청하여 중단했습니다.".into());
                }
                if value["type"] == "control_response" && value["response"]["request_id"] == "init"
                {
                    if value["response"]["subtype"] == "success" {
                        return Ok(value["response"]["response"].clone());
                    }
                    return Err("Claude 연결 초기화 실패".into());
                }
            }
        }
        Err("Claude 연결 초기화 시간이 초과되었습니다.".into())
    }
}
fn parse_subscription_usage(value: &Value) -> Result<SubscriptionUsage, String> {
    let mut usage = SubscriptionUsage::default();
    match value["rate_limits_available"].as_bool() {
        Some(false) => return Ok(usage),
        Some(true) => {}
        None => {
            return Err(
                "Claude 사용 한도 응답 형식이 변경되었습니다. 연결 도구를 확인해 주세요.".into(),
            )
        }
    }
    let rates = value["rate_limits"]
        .as_object()
        .ok_or("Claude 사용 한도 정보를 받지 못했습니다.")?;
    let window = |row: &Value, minutes: u64| -> Option<QuotaWindow> {
        let percent = row["utilization"].as_f64()?;
        if !percent.is_finite() || !(0.0..=100.0).contains(&percent) {
            return None;
        }
        let reset = row["resets_at"]
            .as_str()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .and_then(|date| u64::try_from(date.timestamp()).ok());
        Some(QuotaWindow {
            used_percent: percent,
            window_duration_mins: Some(minutes),
            resets_at: reset,
        })
    };
    let primary = window(&rates.get("five_hour").cloned().unwrap_or(Value::Null), 300);
    let secondary = window(
        &rates.get("seven_day").cloned().unwrap_or(Value::Null),
        10080,
    );
    if primary.is_some() || secondary.is_some() {
        usage.buckets.push(QuotaBucket {
            id: "claude".into(),
            name: "전체 모델".into(),
            primary,
            secondary,
        });
    }
    for (key, label) in [
        ("seven_day_oauth_apps", "연결 앱"),
        ("seven_day_opus", "Opus"),
        ("seven_day_sonnet", "Sonnet"),
    ] {
        if let Some(secondary) = rates.get(key).and_then(|row| window(row, 10080)) {
            usage.buckets.push(QuotaBucket {
                id: key.into(),
                name: label.into(),
                primary: None,
                secondary: Some(secondary),
            });
        }
    }
    for (i, row) in rates
        .get("model_scoped")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(20)
        .enumerate()
    {
        if let Some(secondary) = window(row, 10080) {
            usage.buckets.push(QuotaBucket {
                id: format!("model-{i}"),
                name: row["display_name"]
                    .as_str()
                    .unwrap_or("모델")
                    .chars()
                    .take(60)
                    .collect(),
                primary: None,
                secondary: Some(secondary),
            });
        }
    }
    usage.updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs());
    Ok(usage)
}

fn parse_models(value: &Value) -> Vec<ModelInfo> {
    value["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| {
            let model = m["value"].as_str()?;
            let efforts = m["supportedEffortLevels"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .filter(|e| ["low", "medium", "high", "xhigh", "max"].contains(e))
                .map(str::to_string)
                .collect();
            Some(ModelInfo {
                model: model.into(),
                display_name: format!("Claude · {}", m["displayName"].as_str().unwrap_or(model)),
                efforts,
                default_effort: String::new(),
                is_default: model == "default",
            })
        })
        .collect()
}
#[derive(Default)]
struct TextStream {
    completed: String,
    turn: String,
    partial: bool,
}
impl TextStream {
    fn full(&self) -> String {
        format!("{}{}", self.completed, self.turn)
    }
    fn update(&mut self, value: &Value) -> Result<bool, String> {
        let delta = &value["event"]["delta"];
        let changed = if value["type"] == "stream_event" && delta["type"] == "text_delta" {
            self.turn.push_str(delta["text"].as_str().unwrap_or(""));
            self.partial = true;
            true
        } else if value["type"] == "assistant" && !self.partial {
            self.turn = value["message"]["content"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|c| c["type"] == "text")
                .filter_map(|c| c["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n");
            true
        } else {
            false
        };
        self.check()?;
        Ok(changed)
    }
    fn finish(&mut self, result: &str) -> Result<(), String> {
        if !result.is_empty() {
            self.turn = result.into();
        }
        self.check()
    }
    fn next(&mut self) {
        self.completed.push_str(&self.turn);
        self.completed.push_str("\n\n");
        self.turn.clear();
        self.partial = false;
    }
    fn check(&self) -> Result<(), String> {
        if self.completed.len() + self.turn.len() > 1_000_000 {
            Err("Claude 답변이 너무 큽니다.".into())
        } else {
            Ok(())
        }
    }
}
fn result_error(value: &Value) -> String {
    let text = value.to_string().to_lowercase();
    if text.contains("rate_limit") || text.contains("usage limit") {
        "Claude 구독 사용 한도에 도달했습니다. Claude에서 한도와 초기화 시간을 확인해 주세요."
            .into()
    } else if text.contains("auth") || text.contains("login") {
        DISCONNECTED.into()
    } else {
        "Claude 응답을 완료하지 못했습니다. 모델 사용 권한과 구독 한도를 확인해 주세요.".into()
    }
}
