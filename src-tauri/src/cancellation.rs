//! Per-request cancellation shared by async HTTP and blocking subscription clients.
use std::{collections::HashMap, future::Future, sync::{Arc, Mutex, atomic::{AtomicBool, AtomicU64, Ordering}}};
use tokio::sync::Notify;

pub const CANCELLED: &str = "번역을 중단했습니다.";
#[derive(Clone, Default)]
pub struct Cancellation(Arc<Signal>);
#[derive(Default)]
struct Signal { stopped: AtomicBool, wake: Notify }
impl Cancellation {
    pub fn cancel(&self) { self.0.stopped.store(true, Ordering::SeqCst); self.0.wake.notify_one(); }
    pub fn is_cancelled(&self) -> bool { self.0.stopped.load(Ordering::SeqCst) }
    pub fn check(&self) -> Result<(), String> { if self.is_cancelled() { Err(CANCELLED.into()) } else { Ok(()) } }
    pub async fn run<T>(&self, work: impl Future<Output = Result<T, String>>) -> Result<T, String> {
        self.check()?;
        tokio::select! { biased;
            _ = self.0.wake.notified() => Err(CANCELLED.into()),
            result = work => { self.check()?; result }
        }
    }
}
#[derive(Default)]
pub struct TranslationJobs { next: AtomicU64, jobs: Mutex<HashMap<String, Cancellation>> }
impl TranslationJobs {
    pub fn begin(&self) -> Result<String, String> {
        let id = format!("translation-{}", self.next.fetch_add(1, Ordering::Relaxed));
        self.jobs.lock().map_err(|_| "번역 작업 잠금 오류")?.insert(id.clone(), Cancellation::default());
        Ok(id)
    }
    pub fn get(&self, id: &str) -> Result<Cancellation, String> {
        self.jobs.lock().map_err(|_| "번역 작업 잠금 오류")?.get(id).cloned().ok_or_else(|| CANCELLED.into())
    }
    pub fn cancel(&self, id: &str) -> Result<(), String> {
        if let Some(signal) = self.jobs.lock().map_err(|_| "번역 작업 잠금 오류")?.remove(id) { signal.cancel(); }
        Ok(())
    }
    pub fn finish(&self, id: &str) { if let Ok(mut jobs) = self.jobs.lock() { jobs.remove(id); } }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn stop_drops_pending_http_and_never_cancels_another_request() {
        let jobs = TranslationJobs::default(); let a = jobs.begin().unwrap(); let b = jobs.begin().unwrap();
        let signal = jobs.get(&a).unwrap();
        let task = tokio::spawn(async move { signal.run(std::future::pending::<Result<(), String>>()).await });
        jobs.cancel(&a).unwrap(); assert_eq!(task.await.unwrap().unwrap_err(), CANCELLED);
        assert!(jobs.get(&a).is_err()); assert!(jobs.get(&b).unwrap().check().is_ok()); jobs.finish(&b);
    }
    #[tokio::test]
    async fn cancelled_before_submission_never_runs_the_request() {
        let signal = Cancellation::default(); signal.cancel();
        assert!(signal.run(async { panic!("cancelled work started"); #[allow(unreachable_code)] Ok(()) }).await.is_err());
    }
}
