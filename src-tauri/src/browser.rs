//! OS-default browser dispatch. OAuth stays in the official CLI; this helper only
//! passes its automatic (loopback callback) URL back to the desktop application.
#[cfg(not(target_os = "windows"))]
use std::process::{Command, Stdio};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

pub const CLAUDE_LOGIN_URL_FILE: &str = "PAPER_VOCABULARY_CLAUDE_LOGIN_URL_FILE";

pub fn validate_claude_login_url(raw: &str) -> Result<(), String> {
    let invalid = || "Claude 로그인 주소를 확인하지 못했습니다.".to_string();
    if raw.len() > 16384 || raw.chars().any(char::is_control) {
        return Err(invalid());
    }
    let url = reqwest::Url::parse(raw).map_err(|_| invalid())?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.fragment().is_some()
        || !matches!(
            (url.host_str(), url.path()),
            (Some("claude.com"), "/cai/oauth/authorize") | (Some("claude.ai"), "/oauth/authorize")
        )
    {
        return Err(invalid());
    }
    let redirects: Vec<_> = url
        .query_pairs()
        .filter(|(k, _)| k == "redirect_uri")
        .collect();
    if redirects.len() != 1 {
        return Err(invalid());
    }
    let callback = reqwest::Url::parse(&redirects[0].1).map_err(|_| invalid())?;
    if callback.scheme() != "http"
        || !matches!(callback.host_str(), Some("localhost" | "127.0.0.1"))
        || callback.port().is_none()
        || callback.path() != "/callback"
        || !callback.username().is_empty()
        || callback.password().is_some()
        || callback.query().is_some()
        || callback.fragment().is_some()
    {
        return Err(invalid());
    }
    Ok(())
}

/// Called before Tauri starts, only for a child launched by Claude's BROWSER hook.
/// Never opens a window or handles authorization codes/tokens in this process.
pub fn capture_claude_browser_request() -> Option<Result<(), String>> {
    let destination = std::env::var_os(CLAUDE_LOGIN_URL_FILE)?;
    Some((|| {
        let args: Vec<_> = std::env::args().skip(1).collect();
        if args.len() != 1 {
            return Err("Claude 브라우저 요청 오류".into());
        }
        validate_claude_login_url(&args[0])?;
        write_login_url(Path::new(&destination), &args[0])
    })())
}

fn write_login_url(destination: &Path, url: &str) -> Result<(), String> {
    let stage = destination.with_extension("tmp");
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options.open(&stage)?;
        file.write_all(url.as_bytes())?;
        drop(file);
        fs::rename(&stage, destination)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&stage);
    }
    result.map_err(|_| "Claude 브라우저 요청 전달 실패".into())
}

pub fn helper_executable() -> Result<PathBuf, String> {
    // Re-enter the AppImage so its loader supplies bundled libraries to the helper.
    #[cfg(target_os = "linux")]
    if let Some(path) = std::env::var_os("APPIMAGE").map(PathBuf::from) {
        if path.is_absolute() && path.is_file() {
            return Ok(path);
        }
    }
    std::env::current_exe().map_err(|_| "앱 실행 파일을 찾지 못했습니다.".into())
}

#[cfg(not(target_os = "windows"))]
fn browser_command(url: &str) -> Command {
    #[cfg(target_os = "macos")]
    let mut command = Command::new("/usr/bin/open");
    #[cfg(not(target_os = "macos"))]
    let mut command = if Path::new("/usr/bin/gio").is_file() {
        let mut cmd = Command::new("/usr/bin/gio");
        cmd.arg("open");
        cmd
    } else {
        Command::new("/usr/bin/xdg-open")
    };
    // Preserve desktop/session/default-app settings, discard launcher overrides.
    command
        .env_remove("BROWSER")
        .env_remove("LD_LIBRARY_PATH")
        .env_remove("LD_PRELOAD")
        .env_remove("GIO_MODULE_DIR")
        .env_remove("GIO_EXTRA_MODULES")
        .env_remove("GTK_PATH")
        .env_remove("GSETTINGS_SCHEMA_DIR")
        .env_remove(CLAUDE_LOGIN_URL_FILE)
        .env(
            "PATH",
            "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/snap/bin",
        )
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

pub fn open_default_browser(url: &str) -> Result<(), String> {
    validate_claude_login_url(url)?;
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "shell32")]
        extern "system" {
            fn ShellExecuteW(
                hwnd: *mut std::ffi::c_void,
                operation: *const u16,
                file: *const u16,
                parameters: *const u16,
                directory: *const u16,
                show_cmd: i32,
            ) -> isize;
        }
        let wide: Vec<u16> = std::ffi::OsStr::new(url)
            .encode_wide()
            .chain(Some(0))
            .collect();
        let operation: Vec<u16> = "open\0".encode_utf16().collect();
        // ShellExecute uses the user's HTTPS default-app association; no cmd shell.
        let status = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                operation.as_ptr(),
                wide.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        };
        if status > 32 {
            Ok(())
        } else {
            Err("기본 브라우저를 열지 못했습니다. Windows 기본 앱 설정을 확인해 주세요.".into())
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        use std::time::{Duration, Instant};
        let mut child = browser_command(url)
            .spawn()
            .map_err(|_| "기본 브라우저를 실행하지 못했습니다.")?;
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match child.try_wait() {
                Ok(Some(status)) if status.success() => return Ok(()),
                Ok(Some(_)) | Err(_) => return Err(
                    "기본 브라우저를 열지 못했습니다. 시스템 기본 브라우저 설정을 확인해 주세요."
                        .into(),
                ),
                Ok(None) if Instant::now() >= deadline => {
                    std::thread::spawn(move || {
                        let _ = child.wait();
                    });
                    return Ok(());
                }
                _ => std::thread::sleep(Duration::from_millis(25)),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const URL: &str = "https://claude.com/cai/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A43210%2Fcallback&state=test";
    #[test]
    fn only_claude_https_authorization_with_local_callback_is_opened() {
        assert!(validate_claude_login_url(URL).is_ok());
        for bad in [
            URL.replace("claude.com", "claude.com.evil.test"),
            URL.replace("https:", "http:"),
            URL.replace("localhost", "evil.test"),
            URL.replace("/cai/oauth/authorize", "/"),
            format!("{URL}\n"),
            format!("{URL}&redirect_uri=http://localhost:12/callback"),
            URL.replace("claude.com", "user@claude.com"),
        ] {
            assert!(validate_claude_login_url(&bad).is_err());
        }
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("url");
        write_login_url(&path, URL).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), URL);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }
    #[test]
    #[cfg(not(target_os = "windows"))]
    fn browser_dispatch_uses_system_opener_with_literal_url() {
        let cmd = browser_command(URL);
        assert!(Path::new(cmd.get_program()).is_absolute());
        assert_eq!(cmd.get_args().last().unwrap(), URL);
        assert!(cmd
            .get_envs()
            .any(|(key, value)| key == "BROWSER" && value.is_none()));
        assert!(cmd
            .get_envs()
            .any(|(key, value)| key == "LD_LIBRARY_PATH" && value.is_none()));
    }
}
