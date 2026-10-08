pub mod ai;
pub mod browser;
pub mod chat;
pub mod claude;
pub mod codex;
pub mod connection;
pub mod db;
pub mod history;
pub mod library;
pub mod lookup;
pub mod models;
pub mod page_translation;
pub mod papers;
pub mod usage;

#[cfg(target_os = "linux")]
pub mod uninstall;

#[cfg(all(feature = "reader-profile", target_os = "linux"))]
#[path = "../../tests/performance/native_profile.rs"]
mod native_profile;

#[cfg(feature = "desktop")]
mod desktop;
#[cfg(feature = "desktop")]
mod printing;
#[cfg(feature = "desktop")]
pub use desktop::run;
