CREATE TABLE IF NOT EXISTS paper_chat_memory (
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    through_exchange_id INTEGER NOT NULL REFERENCES paper_chat(id) ON DELETE CASCADE,
    memory_json TEXT NOT NULL,
    PRIMARY KEY(paper_id, through_exchange_id)
);
PRAGMA user_version = 16;
