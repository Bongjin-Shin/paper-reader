use crate::{
    db::{db_error, Database},
    models::Paper,
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFolder {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPaper {
    #[serde(flatten)]
    pub paper: Paper,
    pub folder_id: Option<i64>,
    pub authors: String,
    pub published_date: String,
    pub importance: u8,
    pub uploaded_at: String,
    pub memo: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperMetadata {
    pub title: String,
    pub authors: String,
    pub published_date: String,
}

fn validate_metadata(value: &PaperMetadata) -> Result<(), String> {
    for (text, limit) in [(&value.title, 300), (&value.authors, 1000)] {
        if text.chars().count() > limit || text.chars().any(char::is_control) {
            return Err("논문 제목 또는 저자명 길이와 문자를 확인해 주세요.".into());
        }
    }
    let date = value.published_date.trim();
    if date.is_empty() {
        return Ok(());
    }
    let parts: Vec<&str> = date.split('-').collect();
    if parts.is_empty()
        || parts.len() > 3
        || parts[0].len() != 4
        || parts.iter().skip(1).any(|p| p.len() != 2)
        || parts.iter().any(|p| !p.bytes().all(|c| c.is_ascii_digit()))
    {
        return Err("발행일은 YYYY, YYYY-MM 또는 YYYY-MM-DD로 입력해 주세요.".into());
    }
    let year: u32 = parts[0].parse().unwrap_or(0);
    let month: u32 = parts.get(1).unwrap_or(&"01").parse().unwrap_or(0);
    let day: u32 = parts.get(2).unwrap_or(&"01").parse().unwrap_or(0);
    let days = match month {
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => 31,
    };
    if year == 0 || !(1..=12).contains(&month) || day == 0 || day > days {
        return Err("올바른 발행일을 입력해 주세요.".into());
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct Library {
    pub folders: Vec<LibraryFolder>,
    pub papers: Vec<LibraryPaper>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDeletion {
    pub paper_ids: Vec<String>,
    pub cleanup_pending: bool,
}

fn name(text: &str, limit: usize) -> Result<&str, String> {
    let text = text.trim();
    if text.is_empty() || text.chars().count() > limit || text.chars().any(char::is_control) {
        return Err(format!("이름을 1~{limit}자로 입력해 주세요."));
    }
    Ok(text)
}

fn folder_name(text: &str) -> Result<&str, String> {
    let text = name(text, 100)?;
    if text.contains(['/', '\\']) || matches!(text, "." | "..") {
        return Err("폴더 이름에 /, \\, . 또는 ..를 사용할 수 없습니다.".into());
    }
    Ok(text)
}

fn folder_error(error: rusqlite::Error) -> String {
    if matches!(&error, rusqlite::Error::SqliteFailure(code, _) if code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE)
    {
        "같은 위치에 같은 이름의 폴더가 있습니다.".into()
    } else {
        db_error(error)
    }
}

impl Database {
    pub fn require_folder(&self, folder_id: Option<i64>) -> Result<(), String> {
        if let Some(id) = folder_id {
            let exists: bool = self
                .connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM library_folders WHERE id = ?1)",
                    [id],
                    |r| r.get(0),
                )
                .map_err(db_error)?;
            if !exists {
                return Err("폴더를 찾을 수 없습니다. Library를 다시 열어 주세요.".into());
            }
        }
        Ok(())
    }

    pub fn library(&self) -> Result<Library, String> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT id, parent_id, name FROM library_folders ORDER BY name COLLATE NOCASE, id",
            )
            .map_err(db_error)?;
        let folders = statement
            .query_map([], |r| {
                Ok(LibraryFolder {
                    id: r.get(0)?,
                    parent_id: r.get(1)?,
                    name: r.get(2)?,
                })
            })
            .map_err(db_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db_error)?;
        let mut statement = self.connection.prepare("SELECT p.id, p.file_name, p.title, l.folder_id, p.authors, p.published_date, p.importance, p.added_at, p.memo FROM papers p JOIN library_papers l ON l.paper_id = p.id ORDER BY p.title COLLATE NOCASE, p.id").map_err(db_error)?;
        let papers = statement
            .query_map([], |r| {
                Ok(LibraryPaper {
                    paper: Paper {
                        id: r.get(0)?,
                        file_name: r.get(1)?,
                        title: r.get(2)?,
                    },
                    folder_id: r.get(3)?,
                    authors: r.get(4)?,
                    published_date: r.get(5)?,
                    importance: r.get(6)?,
                    uploaded_at: r.get(7)?,
                    memo: r.get(8)?,
                })
            })
            .map_err(db_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db_error)?;
        Ok(Library { folders, papers })
    }

    pub fn paper(&self, id: &str) -> Result<Paper, String> {
        self.connection
            .query_row(
                "SELECT id, file_name, title FROM papers WHERE id = ?1",
                [id],
                |r| {
                    Ok(Paper {
                        id: r.get(0)?,
                        file_name: r.get(1)?,
                        title: r.get(2)?,
                    })
                },
            )
            .optional()
            .map_err(db_error)?
            .ok_or_else(|| "논문을 찾을 수 없습니다.".into())
    }

    pub fn create_library_folder(
        &self,
        parent_id: Option<i64>,
        text: &str,
    ) -> Result<LibraryFolder, String> {
        let name = folder_name(text)?;
        self.require_folder(parent_id)?;
        self.connection
            .execute(
                "INSERT INTO library_folders(parent_id, name) VALUES (?1, ?2)",
                params![parent_id, name],
            )
            .map_err(folder_error)?;
        Ok(LibraryFolder {
            id: self.connection.last_insert_rowid(),
            parent_id,
            name: name.into(),
        })
    }

    pub fn rename_library_folder(&self, folder_id: i64, text: &str) -> Result<(), String> {
        let name = folder_name(text)?;
        self.require_folder(Some(folder_id))?;
        self.connection
            .execute(
                "UPDATE library_folders SET name = ?1 WHERE id = ?2",
                params![name, folder_id],
            )
            .map_err(folder_error)?;
        Ok(())
    }

    pub fn rename_library_paper(&self, paper_id: &str, text: &str) -> Result<Paper, String> {
        let title = name(text, 300)?;
        if self.connection.execute("UPDATE papers SET title = ?1, title_manual = 1 WHERE id = ?2 AND EXISTS(SELECT 1 FROM library_papers WHERE paper_id = ?2)", params![title, paper_id]).map_err(db_error)? == 0 {
            return Err("Library에서 논문을 찾을 수 없습니다.".into());
        }
        self.paper(paper_id)
    }

    pub fn move_library_paper(&self, paper_id: &str, folder_id: Option<i64>) -> Result<(), String> {
        self.require_folder(folder_id)?;
        if self
            .connection
            .execute(
                "UPDATE library_papers SET folder_id = ?1 WHERE paper_id = ?2",
                params![folder_id, paper_id],
            )
            .map_err(db_error)?
            == 0
        {
            return Err("Library에서 논문을 찾을 수 없습니다.".into());
        }
        Ok(())
    }

    pub fn move_library_papers(
        &mut self,
        paper_ids: &[String],
        folder_id: Option<i64>,
    ) -> Result<(), String> {
        if paper_ids.is_empty() {
            return Err("이동할 논문을 선택해 주세요.".into());
        }
        self.require_folder(folder_id)?;
        let transaction = self.connection.savepoint().map_err(db_error)?;
        for id in paper_ids.iter().collect::<std::collections::BTreeSet<_>>() {
            if transaction
                .execute(
                    "UPDATE library_papers SET folder_id = ?1 WHERE paper_id = ?2",
                    params![folder_id, id],
                )
                .map_err(db_error)?
                == 0
            {
                return Err("Library에서 논문을 찾을 수 없습니다.".into());
            }
        }
        transaction.commit().map_err(db_error)
    }

    /// Automatic extraction refreshes an automatically chosen title and fills missing fields.
    /// Manual corrections remain intact on reopen/reimport; neither operation changes upload time.
    pub fn update_paper_metadata(
        &self,
        paper_id: &str,
        value: &PaperMetadata,
        automatic: bool,
    ) -> Result<Paper, String> {
        validate_metadata(value)?;
        if !automatic {
            name(&value.title, 300)?;
        }
        let exists: bool = self
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM library_papers WHERE paper_id = ?1)",
                [paper_id],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        if !exists {
            return Err("Library에서 논문을 찾을 수 없습니다.".into());
        }
        self.connection.execute(
            "UPDATE papers SET title = CASE WHEN ?5 = 0 OR (title_manual = 0 AND ?2 != '') THEN ?2 ELSE title END,
             authors = CASE WHEN ?5 = 0 OR (metadata_manual = 0 AND authors = '') THEN ?3 ELSE authors END,
             published_date = CASE WHEN ?5 = 0 OR (metadata_manual = 0 AND published_date = '') THEN ?4 ELSE published_date END,
             metadata_checked = 1,
             metadata_manual = CASE WHEN ?5 = 0 THEN 1 ELSE metadata_manual END,
             title_manual = CASE WHEN ?5 = 0 THEN 1 ELSE title_manual END
             WHERE id = ?1",
            params![paper_id, value.title.trim(), value.authors.trim(), value.published_date.trim(), automatic]
        ).map_err(db_error)?;
        self.paper(paper_id)
    }

    pub fn set_paper_importance(&self, paper_id: &str, importance: u8) -> Result<(), String> {
        if !(1..=5).contains(&importance) {
            return Err("중요도는 별 1~5개로 선택해 주세요.".into());
        }
        if self.connection.execute("UPDATE papers SET importance = ?2 WHERE id = ?1 AND EXISTS(SELECT 1 FROM library_papers WHERE paper_id = ?1)", params![paper_id, importance]).map_err(db_error)? == 0 {
            return Err("Library에서 논문을 찾을 수 없습니다.".into());
        }
        Ok(())
    }

    pub fn set_paper_memo(&self, paper_id: &str, memo: &str) -> Result<(), String> {
        if memo.chars().count() > 10_000
            || memo
                .chars()
                .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
        {
            return Err("메모는 10,000자 이내로 입력해 주세요. 줄바꿈과 탭 이외의 제어 문자는 사용할 수 없습니다.".into());
        }
        if self.connection.execute(
            "UPDATE papers SET memo = ?2 WHERE id = ?1 AND EXISTS(SELECT 1 FROM library_papers WHERE paper_id = ?1)",
            params![paper_id, memo],
        ).map_err(db_error)? == 0 {
            return Err("Library에서 논문을 찾을 수 없습니다.".into());
        }
        Ok(())
    }

    pub fn move_library_folder(
        &self,
        folder_id: i64,
        parent_id: Option<i64>,
    ) -> Result<(), String> {
        self.require_folder(Some(folder_id))?;
        self.require_folder(parent_id)?;
        let cyclic: bool = self.connection.query_row(
            "WITH RECURSIVE children(id) AS (SELECT ?1 UNION SELECT f.id FROM library_folders f JOIN children c ON f.parent_id = c.id)
             SELECT EXISTS(SELECT 1 FROM children WHERE id = ?2)", params![folder_id, parent_id], |r| r.get(0)).map_err(db_error)?;
        if cyclic {
            return Err("폴더를 자신이나 하위 폴더로 옮길 수 없습니다.".into());
        }
        self.connection
            .execute(
                "UPDATE library_folders SET parent_id = ?1 WHERE id = ?2",
                params![parent_id, folder_id],
            )
            .map_err(folder_error)?;
        Ok(())
    }

    /// Keep vocabulary and its paper metadata; remove only Library membership and owned PDF copies.
    pub fn delete_library_paper(&mut self, paper_id: &str) -> Result<Vec<String>, String> {
        self.delete_library_papers(&[paper_id.into()])
    }

    pub fn delete_library_papers(&mut self, paper_ids: &[String]) -> Result<Vec<String>, String> {
        if paper_ids.is_empty() {
            return Err("삭제할 논문을 선택해 주세요.".into());
        }
        let ids: Vec<String> = paper_ids
            .iter()
            .cloned()
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();
        let transaction = self.connection.savepoint().map_err(db_error)?;
        for paper_id in &ids {
            let removed = transaction
                .execute("DELETE FROM library_papers WHERE paper_id = ?1", [paper_id])
                .map_err(db_error)?;
            if removed == 0 {
                return Err("Library에서 논문을 찾을 수 없습니다.".into());
            }
            transaction
                .execute(
                    "INSERT OR IGNORE INTO pending_pdf_deletions(paper_id) VALUES (?1)",
                    [paper_id],
                )
                .map_err(db_error)?;
        }
        transaction.commit().map_err(db_error)?;
        Ok(ids)
    }

    pub fn delete_library_folder(&mut self, folder_id: i64) -> Result<Vec<String>, String> {
        self.require_folder(Some(folder_id))?;
        let transaction = self.connection.savepoint().map_err(db_error)?;
        let tree = "WITH RECURSIVE children(id) AS (SELECT ?1 UNION SELECT f.id FROM library_folders f JOIN children c ON f.parent_id = c.id)";
        let papers = {
            let mut statement = transaction
                .prepare(&format!(
                    "{tree} SELECT paper_id FROM library_papers WHERE folder_id IN children"
                ))
                .map_err(db_error)?;
            let rows = statement
                .query_map([folder_id], |r| r.get::<_, String>(0))
                .map_err(db_error)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(db_error)?
        };
        for paper_id in &papers {
            transaction
                .execute(
                    "INSERT OR IGNORE INTO pending_pdf_deletions(paper_id) VALUES (?1)",
                    [paper_id],
                )
                .map_err(db_error)?;
        }
        transaction
            .execute(
                &format!("{tree} DELETE FROM library_papers WHERE folder_id IN children"),
                [folder_id],
            )
            .map_err(db_error)?;
        transaction
            .execute(
                &format!("{tree} DELETE FROM library_folders WHERE id IN children"),
                [folder_id],
            )
            .map_err(db_error)?;
        transaction.commit().map_err(db_error)?;
        Ok(papers)
    }

    pub fn pending_pdf_deletions(&self) -> Result<Vec<String>, String> {
        let mut statement = self
            .connection
            .prepare("SELECT paper_id FROM pending_pdf_deletions")
            .map_err(db_error)?;
        let rows = statement.query_map([], |r| r.get(0)).map_err(db_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
    }

    pub fn finish_pdf_deletion(&self, paper_id: &str) -> Result<(), String> {
        self.connection
            .execute(
                "DELETE FROM pending_pdf_deletions WHERE paper_id = ?1",
                [paper_id],
            )
            .map_err(db_error)?;
        Ok(())
    }
}

/// The caller holds the DB lock, so imports cannot race with cleanup.
pub fn cleanup_deleted_pdfs(db: &Database, papers_dir: &std::path::Path) -> Result<bool, String> {
    let mut pending = false;
    let retained = db.history_papers();
    for id in db.pending_pdf_deletions()? {
        if retained.contains(&id) {
            continue;
        }
        // Never follow the metadata file_path: only content-addressed copies belong to the app.
        if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
            pending = true;
            continue;
        }
        match std::fs::remove_file(papers_dir.join(format!("{id}.pdf"))) {
            Ok(()) => db.finish_pdf_deletion(&id)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                db.finish_pdf_deletion(&id)?
            }
            Err(_) => pending = true,
        }
    }
    Ok(pending)
}
