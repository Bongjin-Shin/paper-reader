use crate::{
    db::Database,
    models::{lookup_key, ActionType, LookupRequest, LookupResult, TextLookupRequest},
    usage::AiResult,
};
use std::{future::Future, sync::Mutex};

/// Shared by the desktop command and tests. Cache lookup precedes even API-key validation.
pub async fn lookup_word<F, Fut>(
    db: &Mutex<Database>,
    request: &LookupRequest,
    fetch: F,
) -> Result<LookupResult, String>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<AiResult, String>>,
{
    request.validate()?;
    if matches!(request.action, ActionType::Explanation) {
        return lookup_explanation(
            db,
            &request.paper_id,
            &request.word,
            &request.original_sentence,
            fetch,
        )
        .await;
    }
    {
        let mut db = db
            .lock()
            .map_err(|_| "데이터베이스 잠금 오류".to_string())?;
        if let Some(result) = db.reuse_lookup(request)? {
            db.clear_redo();
            return Ok(result);
        }
    }
    // Never hold SQLite's mutex while awaiting a network response.
    let response = fetch().await?;
    let mut db = db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류".to_string())?;
    let result = db.complete_lookup(Some(request), response)?;
    db.clear_redo();
    Ok(result)
}

pub async fn lookup_text<F, Fut>(
    db: &Mutex<Database>,
    request: &TextLookupRequest,
    fetch: F,
) -> Result<LookupResult, String>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<AiResult, String>>,
{
    request.validate()?;
    if matches!(request.action, ActionType::Explanation) {
        return lookup_explanation(
            db,
            &request.paper_id,
            &request.selected_text,
            &request.context,
            fetch,
        )
        .await;
    }
    {
        let mut db = db
            .lock()
            .map_err(|_| "데이터베이스 잠금 오류".to_string())?;
        if let Some(result) = db.reuse_text_lookup(request)? {
            db.clear_redo();
            return Ok(result);
        }
    }
    let response = fetch().await?;
    let mut db = db
        .lock()
        .map_err(|_| "데이터베이스 잠금 오류".to_string())?;
    let result = db.complete_text_lookup(request, response)?;
    db.clear_redo();
    Ok(result)
}

/// Explanations are cached independently; they do not touch vocabulary/counts/highlights/history.
async fn lookup_explanation<F, Fut>(
    db: &Mutex<Database>,
    paper: &str,
    text: &str,
    context: &str,
    fetch: F,
) -> Result<LookupResult, String>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<AiResult, String>>,
{
    use crate::db::db_error;
    use rusqlite::params;
    let key = lookup_key(text);
    {
        let db = db.lock().map_err(|_| "데이터베이스 잠금 오류")?;
        db.paper_path(paper)?;
        if let Some(text) = db.cached_explanation(text, context)? {
            return Ok(LookupResult {
                text,
                highlight: None,
            });
        }
    }
    let response = fetch().await?;
    if response.text.trim().is_empty() {
        return Err("빈 결과는 저장할 수 없습니다.".into());
    }
    let db = db.lock().map_err(|_| "데이터베이스 잠금 오류")?;
    let tx = db.connection.unchecked_transaction().map_err(db_error)?;
    db.record_usage(&response)?;
    tx.execute("INSERT INTO explanation_cache(target, context, result) VALUES (?1, ?2, ?3) ON CONFLICT(target, context) DO UPDATE SET result = excluded.result",
        params![key, context, response.text]).map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    Ok(LookupResult {
        text: response.text,
        highlight: None,
    })
}
