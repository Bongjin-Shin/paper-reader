#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(result) = paper_vocabulary_lib::browser::capture_claude_browser_request() {
        std::process::exit(if result.is_ok() { 0 } else { 1 });
    }
    paper_vocabulary_lib::run();
}
