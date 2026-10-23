use crate::models::{
    lookup_key, normalized_word, ActionType, Highlight, HighlightColor, LookupRequest,
    LookupResult, Paper, SavedHighlight, TextLookupRequest, VocabularyContext, VocabularyEntry,
};
use crate::usage::{parse_credit, AiResult, Pricing, UsageSummary};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use std::path::Path;

pub struct Database {
    pub(crate) connection: Connection,
    pub(crate) history: crate::history::History,
}

pub(crate) fn db_error(error: rusqlite::Error) -> String {
    eprintln!("SQLite: {error}");
    "로컬 데이터베이스를 읽거나 저장하지 못했습니다.".into()
}

impl Database {
    pub fn highlight_color(&self) -> Result<HighlightColor, String> {
        let color: String = self
            .connection
            .query_row(
                "SELECT highlight_color FROM reader_settings WHERE id = 1",
                [],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        Ok(HighlightColor::from_name(&color))
    }

    pub fn set_highlight_color(&self, color: HighlightColor) -> Result<(), String> {
        self.connection
            .execute(
                "UPDATE reader_settings SET highlight_color = ?1 WHERE id = 1",
                [color.as_str()],
            )
            .map_err(db_error)?;
        Ok(())
    }

    /// Only remove the requested overlay(s). Vocabulary, context, counts and cache remain intact.
    pub fn remove_highlights(&mut self, paper_id: &str, ids: &[i64]) -> Result<Vec<i64>, String> {
        if ids.is_empty() || ids.len() > 128 {
            return Err("취소할 하이라이트를 다시 선택해 주세요.".into());
        }
        let transaction = self.connection.savepoint().map_err(db_error)?;
        let mut removed = Vec::new();
        for id in ids {
            if transaction
                .execute(
                    "DELETE FROM highlights WHERE id = ?1 AND paper_id = ?2",
                    params![id, paper_id],
                )
                .map_err(db_error)?
                > 0
            {
                removed.push(*id);
            }
        }
        transaction.commit().map_err(db_error)?;
        Ok(removed)
    }

    /// An entry owns all of its contexts/cache and highlights, across papers.
    /// Paper files, settings and historical API charges are independent of it.
    pub fn delete_vocabulary(&mut self, ids: &[i64]) -> Result<Vec<i64>, String> {
        if ids.iter().any(|id| *id <= 0) {
            return Err("삭제할 단어를 다시 선택해 주세요.".into());
        }
        let transaction = self.connection.savepoint().map_err(db_error)?;
        let mut removed = Vec::new();
        for id in ids {
            transaction
                .execute(
                    "DELETE FROM highlights WHERE vocabulary_entry_id = ?1 OR context_id IN
                 (SELECT id FROM vocabulary_contexts WHERE vocabulary_entry_id = ?1)",
                    [id],
                )
                .map_err(db_error)?;
            transaction
                .execute(
                    "DELETE FROM vocabulary_contexts WHERE vocabulary_entry_id = ?1",
                    [id],
                )
                .map_err(db_error)?;
            if transaction
                .execute("DELETE FROM vocabulary_entries WHERE id = ?1", [id])
                .map_err(db_error)?
                > 0
            {
                removed.push(*id);
            }
        }
        transaction.commit().map_err(db_error)?;
        Ok(removed)
    }

    pub fn reuse_text_lookup(
        &mut self,
        request: &TextLookupRequest,
    ) -> Result<Option<LookupResult>, String> {
        request.validate()?;
        self.paper_path(&request.paper_id)?;
        let Some(text) =
            self.cached_result(&request.selected_text, &request.context, request.action)?
        else {
            return Ok(None);
        };
        self.save_text_lookup(request, &text)?;
        Ok(Some(LookupResult {
            text,
            highlight: None,
        }))
    }

    pub fn save_text_lookup(
        &mut self,
        request: &TextLookupRequest,
        result: &str,
    ) -> Result<(), String> {
        request.validate()?;
        if result.trim().is_empty() {
            return Err("빈 결과는 저장할 수 없습니다.".into());
        }
        let reserved = self.history.reserved_ids();
        let transaction = self.connection.transaction().map_err(db_error)?;
        save_context(
            &transaction,
            &request.paper_id,
            request.page_number,
            (&request.selected_text, &request.context),
            request.action,
            result,
            reserved,
        )?;
        transaction.commit().map_err(db_error)
    }

    pub fn complete_text_lookup(
        &mut self,
        request: &TextLookupRequest,
        response: AiResult,
    ) -> Result<LookupResult, String> {
        if response.text.trim().is_empty() {
            return Err("빈 결과는 저장할 수 없습니다.".into());
        }
        self.record_usage(&response)?;
        self.save_text_lookup(request, &response.text)?;
        Ok(LookupResult {
            text: response.text,
            highlight: None,
        })
    }
    pub fn complete_lookup(
        &mut self,
        word: Option<&LookupRequest>,
        response: AiResult,
    ) -> Result<LookupResult, String> {
        if response.text.trim().is_empty() {
            return Err("빈 결과는 저장할 수 없습니다.".into());
        }
        self.record_usage(&response)?;
        let highlight = word
            .map(|request| self.save_lookup(request, &response.text))
            .transpose()?;
        Ok(LookupResult {
            text: response.text,
            highlight,
        })
    }
    pub fn open(path: &Path) -> Result<Self, String> {
        let connection = Connection::open(path).map_err(db_error)?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(db_error)?;
        connection
            .execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
            .map_err(db_error)?;
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(db_error)?;
        if version > 17 {
            return Err("더 최신 버전에서 만든 데이터베이스입니다.".into());
        }
        if version == 0 {
            connection
                .execute_batch(concat!(
                    "BEGIN;",
                    include_str!("../migrations/001_initial.sql"),
                    "COMMIT;"
                ))
                .map_err(db_error)?;
        }
        if version < 2 {
            connection
                .execute_batch(concat!(
                    "BEGIN;",
                    include_str!("../migrations/002_api_usage.sql"),
                    "COMMIT;"
                ))
                .map_err(db_error)?;
        }
        if version < 3 {
            connection
                .execute_batch(concat!(
                    "BEGIN;",
                    include_str!("../migrations/003_vocabulary.sql"),
                    "COMMIT;"
                ))
                .map_err(db_error)?;
        }
        if version < 4 {
            connection
                .execute_batch(concat!(
                    "BEGIN;",
                    include_str!("../migrations/004_reader_tools.sql"),
                    "COMMIT;"
                ))
                .map_err(db_error)?;
        }
        if version < 5 {
            connection
                .execute_batch(concat!(
                    "BEGIN;",
                    include_str!("../migrations/005_library.sql"),
                    "COMMIT;"
                ))
                .map_err(db_error)?;
        }
        if version < 6 {
            connection
                .execute_batch(concat!(
                    "BEGIN;",
                    include_str!("../migrations/006_paper_metadata.sql"),
                    "COMMIT;"
                ))
                .map_err(db_error)?;
        }
        if version < 7 {
            connection
                .execute_batch(concat!(
                    "BEGIN;",
                    include_str!("../migrations/007_library_folders_and_metadata.sql"),
                    "COMMIT;"
                ))
                .map_err(db_error)?;
        }
        if version < 8 {
            connection
                .execute_batch(concat!(
                    "BEGIN;",
                    include_str!("../migrations/008_paper_memo.sql"),
                    "COMMIT;"
                ))
                .map_err(db_error)?;
        }
        if version < 9 {
            connection
                .execute_batch(concat!(
                    "BEGIN;",
                    include_str!("../migrations/009_ai_provider.sql"),
                    "COMMIT;"
                ))
                .map_err(db_error)?;
        }
        if version < 10 {
            connection
                .execute_batch(concat!(
                    "BEGIN;",
                    include_str!("../migrations/010_page_translations.sql"),
                    "COMMIT;"
                ))
                .map_err(db_error)?;
        }
        if version < 11 {
            connection
                .execute_batch(concat!(
                    "BEGIN;",
                    include_str!("../migrations/011_explanation_cache.sql"),
                    "COMMIT;"
                ))
                .map_err(db_error)?;
        }
        if version < 12 {
            connection
                .execute_batch(concat!(
                    "BEGIN;",
                    include_str!("../migrations/012_models_chat.sql"),
                    "COMMIT;"
                ))
                .map_err(db_error)?;
        }
        if version < 13 {
            connection
                .execute_batch(concat!(
                    "BEGIN;",
                    include_str!("../migrations/013_chat_interaction.sql"),
                    "COMMIT;"
                ))
                .map_err(db_error)?;
        }
        if version < 14 {
            connection
                .execute_batch(concat!(
                    "BEGIN;",
                    include_str!("../migrations/014_chat_branches.sql"),
                    "COMMIT;"
                ))
                .map_err(db_error)?;
        }
        if version < 15 {
            connection
                .execute_batch(concat!(
                    "BEGIN;",
                    include_str!("../migrations/015_claude.sql"),
                    "COMMIT;"
                ))
                .map_err(db_error)?;
        }
        if version < 16 {
            connection.execute_batch(concat!("BEGIN;", include_str!("../migrations/016_chat_memory.sql"), "COMMIT;")).map_err(db_error)?;
        }
        if version < 17 {
            connection.execute_batch(concat!("BEGIN;", include_str!("../migrations/017_paper_fingerprints.sql"), "COMMIT;")).map_err(db_error)?;
        }
        Ok(Self {
            connection,
            history: Default::default(),
        })
    }

    pub fn usage_summary(&self) -> Result<UsageSummary, String> {
        let initial: Option<i64> = self
            .connection
            .query_row(
                "SELECT initial_nano_usd FROM api_credit WHERE id = 1",
                [],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        let (total, estimated): (i64, i64) = self.connection.query_row(
            "SELECT COALESCE(SUM(cost_nano_usd), 0), COALESCE(SUM(estimated_tokens), 0) FROM api_usage", [],
            |r| Ok((r.get(0)?, r.get(1)?))).map_err(db_error)?;
        Ok(UsageSummary {
            initial_credit_usd: initial.map(|n| n as f64 / 1e9),
            total_cost_usd: total as f64 / 1e9,
            estimated_balance_usd: initial.map(|n| (n - total) as f64 / 1e9),
            estimated_calls: estimated,
            pricing: Pricing::default(),
        })
    }

    pub fn set_initial_credit(&self, usd: &str) -> Result<UsageSummary, String> {
        let amount = parse_credit(usd)?;
        self.connection
            .execute(
                "UPDATE api_credit SET initial_nano_usd = ?1 WHERE id = 1",
                [amount],
            )
            .map_err(db_error)?;
        self.usage_summary()
    }

    /// One record per successful API response; no text or PDF data is stored here.
    pub fn record_usage(&self, response: &AiResult) -> Result<(), String> {
        if response.provider != crate::connection::AiProvider::Api {
            return Ok(());
        }
        let pricing = Pricing::default();
        let cost = response.usage.cost(&pricing)?;
        self.connection.execute(
            "INSERT INTO api_usage(response_id, model, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens,
             estimated_tokens, pricing_json, cost_nano_usd) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(response_id) DO NOTHING",
            params![response.response_id, pricing.model, response.usage.input, response.usage.cached_input,
                response.usage.cache_write, response.usage.output, response.usage.estimated,
                serde_json::to_string(&pricing).map_err(|_| "단가 저장 실패".to_string())?, cost]).map_err(db_error)?;
        Ok(())
    }

    pub fn register_paper(&self, paper: &Paper, path: &Path) -> Result<(), String> {
        self.register_paper_at(paper, path, None)
    }

    pub fn register_paper_at(
        &self,
        paper: &Paper,
        path: &Path,
        folder: Option<Option<i64>>,
    ) -> Result<(), String> {
        self.register_paper_import(paper, path, folder, None)
    }

    pub(crate) fn register_paper_import(
        &self,
        paper: &Paper,
        path: &Path,
        folder: Option<Option<i64>>,
        fingerprint: Option<&str>,
    ) -> Result<(), String> {
        if let Some(folder_id) = folder {
            self.require_folder(folder_id)?;
        }
        let transaction = self.connection.unchecked_transaction().map_err(db_error)?;
        transaction
            .execute(
                "INSERT INTO papers(id, file_name, file_path, title) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET file_path = excluded.file_path,
             added_at = CASE WHEN ?5 OR NOT EXISTS(SELECT 1 FROM library_papers WHERE paper_id = ?1)
                 THEN excluded.added_at ELSE papers.added_at END,
             last_opened_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
                params![
                    paper.id,
                    paper.file_name,
                    path.to_string_lossy(),
                    paper.title,
                    folder.is_some()
                ],
            )
            .map_err(db_error)?;
        transaction
            .execute(
                "INSERT INTO library_papers(paper_id) VALUES (?1) ON CONFLICT(paper_id) DO NOTHING",
                [&paper.id],
            )
            .map_err(db_error)?;
        if let Some(folder_id) = folder {
            transaction
                .execute(
                    "UPDATE library_papers SET folder_id = ?1 WHERE paper_id = ?2",
                    params![folder_id, paper.id],
                )
                .map_err(db_error)?;
        }
        transaction
            .execute(
                "DELETE FROM pending_pdf_deletions WHERE paper_id = ?1",
                [&paper.id],
            )
            .map_err(db_error)?;
        if let Some(fingerprint) = fingerprint {
            transaction.execute(
                "INSERT INTO paper_fingerprints(paper_id, fingerprint) VALUES (?1, ?2)
                 ON CONFLICT(paper_id) DO UPDATE SET fingerprint = excluded.fingerprint",
                params![paper.id, fingerprint],
            ).map_err(db_error)?;
        }
        transaction.commit().map_err(db_error)?;
        Ok(())
    }

    pub fn paper_path(&self, id: &str) -> Result<String, String> {
        self.connection
            .query_row("SELECT file_path FROM papers WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .map_err(|_| "등록된 PDF를 찾을 수 없습니다. 파일을 다시 열어 주세요.".into())
    }

    pub fn papers(&self) -> Result<Vec<Paper>, String> {
        let mut statement = self
            .connection
            .prepare("SELECT id, file_name, title FROM papers ORDER BY title COLLATE NOCASE, id")
            .map_err(db_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok(Paper {
                    id: row.get(0)?,
                    file_name: row.get(1)?,
                    title: row.get(2)?,
                })
            })
            .map_err(db_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
    }

    pub(crate) fn cached_result(
        &self,
        word: &str,
        context: &str,
        action: ActionType,
    ) -> Result<Option<String>, String> {
        self.connection.query_row(
            "SELECT c.result FROM vocabulary_contexts c JOIN vocabulary_entries e ON e.id = c.vocabulary_entry_id
             WHERE e.word = ?1 AND c.original_sentence = ?2 AND c.action_type = ?3 AND length(trim(c.result)) > 0
             ORDER BY c.id DESC LIMIT 1",
            params![lookup_key(word), context, action.as_str()], |row| row.get(0),
        ).optional().map_err(db_error)
    }

    pub fn reuse_lookup(
        &mut self,
        request: &LookupRequest,
    ) -> Result<Option<LookupResult>, String> {
        request.validate()?;
        self.paper_path(&request.paper_id)?;
        let Some(text) =
            self.cached_result(&request.word, &request.original_sentence, request.action)?
        else {
            return Ok(None);
        };
        // An explicit cached lookup still records this occurrence/count; no API usage write.
        let highlight = self.save_lookup(request, &text)?;
        Ok(Some(LookupResult {
            text,
            highlight: Some(highlight),
        }))
    }

    pub fn saved_highlight(
        &self,
        paper_id: &str,
        highlight_id: i64,
    ) -> Result<SavedHighlight, String> {
        let (word, context, action, text): (String, String, String, String) = self
            .connection
            .query_row(
                "SELECT h.selected_text, c.original_sentence, c.action_type, c.result
             FROM highlights h JOIN vocabulary_contexts c ON c.id = h.context_id
             WHERE h.id = ?1 AND h.paper_id = ?2",
                params![highlight_id, paper_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(db_error)?
            .ok_or("저장된 하이라이트 결과를 찾을 수 없습니다.")?;
        let action = if action == "translation" {
            ActionType::Translation
        } else {
            ActionType::Explanation
        };
        let translation = match action {
            ActionType::Translation => Some(text.clone()),
            ActionType::Explanation => {
                self.cached_result(&word, &context, ActionType::Translation)?
            }
        };
        let explanation = match action {
            ActionType::Explanation => Some(text.clone()),
            ActionType::Translation => self.cached_explanation(&word, &context)?,
        };
        Ok(SavedHighlight {
            original_sentence: context,
            action,
            text,
            translation,
            explanation,
        })
    }

    pub(crate) fn cached_explanation(
        &self,
        text: &str,
        context: &str,
    ) -> Result<Option<String>, String> {
        let cached = self
            .connection
            .query_row(
                "SELECT result FROM explanation_cache WHERE target = ?1 AND context = ?2",
                params![crate::models::lookup_key(text), context],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_error)?;
        match cached {
            Some(text) => Ok(Some(text)),
            None => self.cached_result(text, context, ActionType::Explanation),
        }
    }

    pub fn vocabulary(
        &self,
        query: &str,
        paper_id: Option<&str>,
    ) -> Result<Vec<VocabularyEntry>, String> {
        let search = normalized_word(query.trim());
        let mut statement = self
            .connection
            .prepare(
                "SELECT e.id, e.word, e.lookup_count, c.paper_id, p.title, c.page_number,
                    c.original_sentence, c.action_type, c.result
             FROM vocabulary_entries e JOIN vocabulary_contexts c ON c.vocabulary_entry_id = e.id
             JOIN papers p ON p.id = c.paper_id
             WHERE (?1 IS NULL OR c.paper_id = ?1) AND (?2 = '' OR instr(lower(e.word), ?2) > 0 OR EXISTS (
                 SELECT 1 FROM vocabulary_contexts meaning WHERE meaning.vocabulary_entry_id = e.id
                 AND meaning.action_type = 'translation' AND (?1 IS NULL OR meaning.paper_id = ?1)
                 AND instr(meaning.result, ?3) > 0
             )) ORDER BY e.word, e.id, c.id",
            )
            .map_err(db_error)?;
        let mut rows = statement
            .query(params![paper_id, search, query.trim()])
            .map_err(db_error)?;
        let mut entries: Vec<VocabularyEntry> = Vec::new();
        let mut entry_indices = HashMap::new();
        let mut context_indices = HashMap::new();
        while let Some(row) = rows.next().map_err(db_error)? {
            let id: i64 = row.get(0).map_err(db_error)?;
            let entry_index = if let Some(&index) = entry_indices.get(&id) {
                index
            } else {
                let index = entries.len();
                entries.push(VocabularyEntry {
                    id,
                    word: row.get(1).map_err(db_error)?,
                    lookup_count: row.get(2).map_err(db_error)?,
                    translation: None,
                    explanation: None,
                    contexts: Vec::new(),
                });
                entry_indices.insert(id, index);
                index
            };
            let entry = &mut entries[entry_index];
            let paper_id: String = row.get(3).map_err(db_error)?;
            let page_number: u32 = row.get(5).map_err(db_error)?;
            let sentence: String = row.get(6).map_err(db_error)?;
            let key = (id, paper_id.clone(), page_number, sentence.clone());
            let context_index = if let Some(&index) = context_indices.get(&key) {
                index
            } else {
                let index = entry.contexts.len();
                entry.contexts.push(VocabularyContext {
                    paper_id,
                    paper_title: row.get(4).map_err(db_error)?,
                    page_number,
                    original_sentence: sentence,
                    translation: None,
                    explanation: None,
                });
                context_indices.insert(key, index);
                index
            };
            let action: String = row.get(7).map_err(db_error)?;
            let result: String = row.get(8).map_err(db_error)?;
            // Keep all distinct paper/page/sentence contexts; merge repeated actions for display.
            if action == "translation" {
                entry.contexts[context_index].translation = Some(result.clone());
                entry.translation = Some(result);
            } else {
                entry.contexts[context_index].explanation = Some(result.clone());
                entry.explanation = Some(result);
            }
        }
        Ok(entries)
    }

    pub fn highlights(&self, paper_id: &str) -> Result<Vec<Highlight>, String> {
        let mut statement = self.connection.prepare(
            "SELECT id, paper_id, vocabulary_entry_id, page_number, selected_text, position_data, color
             FROM highlights WHERE paper_id = ?1 ORDER BY page_number, id",
        ).map_err(db_error)?;
        let rows = statement
            .query_map([paper_id], |row| {
                let json: String = row.get(5)?;
                let position = serde_json::from_str(&json).map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        5,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })?;
                Ok(Highlight {
                    id: row.get(0)?,
                    paper_id: row.get(1)?,
                    vocabulary_entry_id: row.get(2)?,
                    page_number: row.get(3)?,
                    selected_text: row.get(4)?,
                    position,
                    color: HighlightColor::from_name(&row.get::<_, String>(6)?),
                })
            })
            .map_err(db_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
    }

    /// A successful explicit lookup (API or cache). Entry/count, context and highlight commit together.
    pub fn save_lookup(
        &mut self,
        request: &LookupRequest,
        result: &str,
    ) -> Result<Highlight, String> {
        request.validate()?;
        if result.trim().is_empty() {
            return Err("빈 결과는 저장할 수 없습니다.".into());
        }
        let position =
            serde_json::to_string(&request.position).map_err(|_| "위치 저장 실패".to_string())?;
        let reserved = self.history.reserved_ids();
        let transaction = self.connection.transaction().map_err(db_error)?;
        let (entry_id, context_id) = save_context(
            &transaction,
            &request.paper_id,
            request.page_number,
            (&request.word, &request.original_sentence),
            request.action,
            result,
            reserved,
        )?;
        let (id, color): (i64, String) = transaction.query_row(
            "INSERT INTO highlights(id, paper_id, vocabulary_entry_id, context_id, page_number, selected_text, position_data, color)
             VALUES ((SELECT max(COALESCE(MAX(id), 0), ?8) + 1 FROM highlights), ?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(paper_id, page_number, position_data) DO UPDATE SET context_id = excluded.context_id,
             vocabulary_entry_id = excluded.vocabulary_entry_id, selected_text = excluded.selected_text
             RETURNING id, color",
            params![request.paper_id, entry_id, context_id, request.page_number, request.word, position, request.color.as_str(), reserved[2]], |r| Ok((r.get(0)?, r.get(1)?)),
        ).map_err(db_error)?;
        transaction.commit().map_err(db_error)?;
        Ok(Highlight {
            id,
            paper_id: request.paper_id.clone(),
            vocabulary_entry_id: entry_id,
            page_number: request.page_number,
            selected_text: request.word.clone(),
            position: request.position.clone(),
            color: HighlightColor::from_name(&color),
        })
    }
}

fn save_context(
    transaction: &rusqlite::Transaction<'_>,
    paper_id: &str,
    page_number: u32,
    text_and_context: (&str, &str),
    action: ActionType,
    result: &str,
    reserved: [i64; 3],
) -> Result<(i64, i64), String> {
    let (text, context) = text_and_context;
    let (translation, explanation) = match action {
        ActionType::Translation => (Some(result), None),
        ActionType::Explanation => (None, Some(result)),
    };
    let entry_id = transaction.query_row(
        "INSERT INTO vocabulary_entries(id, word, translation, explanation, lookup_count) VALUES ((SELECT max(COALESCE(MAX(id), 0), ?4) + 1 FROM vocabulary_entries), ?1, ?2, ?3, 1)
         ON CONFLICT(word) DO UPDATE SET translation = COALESCE(excluded.translation, vocabulary_entries.translation),
         explanation = COALESCE(excluded.explanation, vocabulary_entries.explanation),
         lookup_count = vocabulary_entries.lookup_count + 1,
         last_lookup_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') RETURNING id",
        params![lookup_key(text), translation, explanation, reserved[0]], |r| r.get(0)).map_err(db_error)?;
    transaction.execute(
        "INSERT INTO vocabulary_contexts(id, vocabulary_entry_id, paper_id, page_number, original_sentence, action_type, result)
         VALUES ((SELECT max(COALESCE(MAX(id), 0), ?7) + 1 FROM vocabulary_contexts), ?1, ?2, ?3, ?4, ?5, ?6)", params![entry_id, paper_id, page_number, context, action.as_str(), result, reserved[1]]).map_err(db_error)?;
    Ok((entry_id, transaction.last_insert_rowid()))
}
