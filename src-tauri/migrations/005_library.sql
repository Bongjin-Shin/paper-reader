CREATE TABLE library_folders (
    id INTEGER PRIMARY KEY,
    parent_id INTEGER REFERENCES library_folders(id),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0)
);
CREATE UNIQUE INDEX library_folder_names ON library_folders(COALESCE(parent_id, 0), name COLLATE NOCASE);
CREATE TABLE library_papers (
    paper_id TEXT PRIMARY KEY REFERENCES papers(id),
    folder_id INTEGER REFERENCES library_folders(id)
);
CREATE INDEX library_papers_folder ON library_papers(folder_id);
INSERT INTO library_papers(paper_id) SELECT id FROM papers;
-- File cleanup is retried after restart if deletion was interrupted.
CREATE TABLE pending_pdf_deletions (paper_id TEXT PRIMARY KEY);
PRAGMA user_version = 5;
