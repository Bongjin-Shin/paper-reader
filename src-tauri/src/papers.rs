use crate::{db::Database, models::Paper};
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
    let (paper, destination) = copy_pdf(source, papers_dir)?;
    db.register_paper(&paper, &destination)?;
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
    let (paper, destination) = copy_pdf(source, papers_dir)?;
    db.register_paper_at(&paper, &destination, Some(folder_id))?;
    db.paper(&paper.id)
}

fn copy_pdf(source: &Path, papers_dir: &Path) -> Result<(Paper, PathBuf), String> {
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
    let id = format!("{:x}", Sha256::digest(&bytes));
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
    Ok((paper, destination))
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
