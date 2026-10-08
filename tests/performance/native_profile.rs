//! Explicit test build only. Never compiled into the distributed application.
use std::io::Write;
use webkit2gtk::{UserContentManagerExt, WebViewExt};

pub fn install(view: &webkit2gtk::WebView) {
    let Ok(output) = std::env::var("READER_PROFILE_OUTPUT") else {
        return;
    };
    let manager = view.user_content_manager().unwrap();
    manager.register_script_message_handler("readerProfile");
    manager.connect_script_message_received(Some("readerProfile"), move |_, result| {
        if let Some(value) = result.js_value() {
            if let Ok(mut file) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&output)
            {
                let _ = writeln!(file, "{value}");
            }
        }
    });
    manager.add_script(&webkit2gtk::UserScript::new(
        include_str!("native-motion.js"),
        webkit2gtk::UserContentInjectedFrames::TopFrame,
        webkit2gtk::UserScriptInjectionTime::End,
        &[],
        &[],
    ));
}
