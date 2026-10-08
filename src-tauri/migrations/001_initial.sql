PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS papers (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    title TEXT NOT NULL,
    added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_opened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS vocabulary_entries (
    id INTEGER PRIMARY KEY,
    word TEXT NOT NULL UNIQUE,
    translation TEXT,
    explanation TEXT,
    first_lookup_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_lookup_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    status TEXT NOT NULL DEFAULT 'new'
);

CREATE TABLE IF NOT EXISTS vocabulary_contexts (
    id INTEGER PRIMARY KEY,
    vocabulary_entry_id INTEGER NOT NULL REFERENCES vocabulary_entries(id),
    paper_id TEXT NOT NULL REFERENCES papers(id),
    page_number INTEGER NOT NULL CHECK (page_number > 0),
    original_sentence TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK (action_type IN ('translation', 'explanation')),
    result TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS highlights (
    id INTEGER PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES papers(id),
    vocabulary_entry_id INTEGER NOT NULL REFERENCES vocabulary_entries(id),
    context_id INTEGER NOT NULL REFERENCES vocabulary_contexts(id),
    page_number INTEGER NOT NULL CHECK (page_number > 0),
    selected_text TEXT NOT NULL,
    position_data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (paper_id, page_number, position_data)
);
CREATE INDEX IF NOT EXISTS highlights_paper_page ON highlights(paper_id, page_number);
CREATE INDEX IF NOT EXISTS contexts_entry ON vocabulary_contexts(vocabulary_entry_id);
PRAGMA user_version = 1;
