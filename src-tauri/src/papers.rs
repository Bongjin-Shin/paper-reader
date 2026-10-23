use crate::{
    db::{db_error, Database},
    models::Paper,
    pdf_identity,
};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperImportBatch {
    pub papers: Vec<Paper>,
    pub failures: Vec<PaperImportFailure>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperImportFailure {
    pub file_name: String,
    pub message: String,
}

/// Process one file at a time so large drops do not keep all PDFs in memory.
/// A failed file does not discard other successfully imported papers.
pub fn import_pdfs(
    sources: &[PathBuf],
    papers_dir: &Path,
    db: &Database,
    folder: Option<Option<i64>>,
) -> Result<PaperImportBatch, String> {
    if let Some(folder_id) = folder {
        db.require_folder(folder_id)?;
    }
    let mut result = PaperImportBatch::default();
    let mut paths = HashSet::new();
    let mut ids = HashSet::new();
    for path in sources {
        if !paths.insert(path) {
            continue;
        }
        let imported = match folder {
            Some(folder_id) => import_library_pdf(path, papers_dir, db, folder_id),
            None => import_pdf(path, papers_dir, db),
        };
        match imported {
            Ok(paper) => {
                if ids.insert(paper.id.clone()) {
                    result.papers.push(paper);
                }
            }
            Err(message) => result.failures.push(PaperImportFailure {
                file_name: path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                message,
            }),
        }
    }
    Ok(result)
}

pub fn import_pdf(source: &Path, papers_dir: &Path, db: &Database) -> Result<Paper, String> {
    let (paper, destination, fingerprint) = copy_pdf(source, papers_dir, db)?;
    db.register_paper_import(&paper, &destination, None, Some(&fingerprint))?;
    let mut opened = db.paper(&paper.id)?;
    // Keep a user-assigned title, while the Reader still shows the selected filename
    // when an identical PDF is opened from another path under its default name.
    if opened.title == opened.file_name {
        opened.title = paper.file_name.clone();
    }
    opened.file_name = paper.file_name;
    Ok(opened)
}

pub fn import_library_pdf(
    source: &Path,
    papers_dir: &Path,
    db: &Database,
    folder_id: Option<i64>,
) -> Result<Paper, String> {
    db.require_folder(folder_id)?;
    let (paper, destination, fingerprint) = copy_pdf(source, papers_dir, db)?;
    db.register_paper_import(&paper, &destination, Some(folder_id), Some(&fingerprint))?;
    db.paper(&paper.id)
}

fn copy_pdf(
    source: &Path,
    papers_dir: &Path,
    db: &Database,
) -> Result<(Paper, PathBuf, String), String> {
    if !source
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
    {
        return Err("PDF 파일만 열 수 있습니다.".into());
    }
    let file = fs::File::open(source).map_err(|error| {
        eprintln!("PDF open failed: {source:?}: {error}");
        "PDF 파일을 읽을 수 없습니다.".to_string()
    })?;
    let mut bytes = Vec::new();
    file.take(256 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "PDF 읽기 실패".to_string())?;
    if bytes.len() > 256 * 1024 * 1024 {
        return Err("256MB 이하의 PDF를 열어 주세요.".into());
    }
    if !bytes
        .iter()
        .take(1024)
        .copied()
        .collect::<Vec<_>>()
        .windows(5)
        .any(|w| w == b"%PDF-")
    {
        return Err("올바른 PDF 파일이 아닙니다.".into());
    }
    let byte_id = format!("{:x}", Sha256::digest(&bytes));
    let fingerprint = pdf_identity::fingerprint(&bytes).unwrap_or_default();
    let id = if fingerprint.is_empty() {
        byte_id
    } else {
        db.backfill_paper_fingerprints()?;
        db.connection
            .query_row(
                "SELECT p.id FROM papers p JOIN paper_fingerprints f ON f.paper_id = p.id
             LEFT JOIN library_papers l ON l.paper_id = p.id WHERE f.fingerprint = ?1
             ORDER BY l.paper_id IS NULL, p.rowid LIMIT 1",
                [&fingerprint],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_error)?
            .unwrap_or(byte_id)
    };
    let destination = papers_dir.join(format!("{id}.pdf"));
    if !destination.exists() {
        let temporary = papers_dir.join(format!("{id}.tmp"));
        let write_result = (|| -> std::io::Result<()> {
            let mut file = fs::File::create(&temporary)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            fs::rename(&temporary, &destination)
        })();
        if write_result.is_err() {
            let _ = fs::remove_file(temporary);
            return Err("앱 폴더에 PDF 사본을 저장하지 못했습니다.".into());
        }
    }
    let file_name = source
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "paper.pdf".into());
    let paper = Paper {
        id,
        title: file_name.clone(),
        file_name,
    };
    Ok((paper, destination, fingerprint))
}

impl Database {
    // Index old installations lazily on import, without changing IDs or user data.
    fn backfill_paper_fingerprints(&self) -> Result<(), String> {
        let mut statement = self.connection.prepare(
            "SELECT p.id, p.file_path FROM papers p LEFT JOIN paper_fingerprints f ON f.paper_id = p.id
             WHERE f.paper_id IS NULL",
        ).map_err(db_error)?;
        let missing = statement
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(db_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db_error)?;
        for (id, path) in missing {
            let fingerprint = fs::File::open(path)
                .ok()
                .and_then(|file| {
                    let mut bytes = Vec::new();
                    file.take(256 * 1024 * 1024 + 1)
                        .read_to_end(&mut bytes)
                        .ok()?;
                    if bytes.len() > 256 * 1024 * 1024 {
                        return None;
                    }
                    pdf_identity::fingerprint(&bytes)
                })
                .unwrap_or_default();
            self.connection
                .execute(
                    "INSERT INTO paper_fingerprints(paper_id, fingerprint) VALUES (?1, ?2)",
                    params![id, fingerprint],
                )
                .map_err(db_error)?;
        }
        Ok(())
    }
}

pub fn dropped_pdfs(paths: &[PathBuf]) -> Result<Vec<PathBuf>, String> {
    if !paths.iter().any(|path| {
        path.is_file()
            && path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
    }) {
        return Err("PDF 파일만 열 수 있습니다.".into());
    }
    // Keep non-PDF paths in a mixed drop so import can report each skipped file.
    let mut seen = HashSet::new();
    Ok(paths
        .iter()
        .filter(|path| seen.insert(*path))
        .cloned()
        .collect())
}
