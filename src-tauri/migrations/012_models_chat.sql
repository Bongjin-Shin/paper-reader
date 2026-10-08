ALTER TABLE ai_preferences ADD COLUMN translation_model TEXT NOT NULL DEFAULT 'gpt-5.6-luna';
ALTER TABLE ai_preferences ADD COLUMN chat_model TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_preferences ADD COLUMN chat_effort TEXT NOT NULL DEFAULT '';
CREATE TABLE paper_chat (
    id INTEGER PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    model TEXT NOT NULL,
    effort TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX paper_chat_paper ON paper_chat(paper_id, id);
CREATE TABLE shared_sentence_translations (
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    translation TEXT NOT NULL,
    PRIMARY KEY(paper_id, source)
);
PRAGMA user_version = 12;
