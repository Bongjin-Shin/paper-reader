ALTER TABLE paper_chat ADD COLUMN parent_id INTEGER REFERENCES paper_chat(id);
UPDATE paper_chat SET parent_id = (
    SELECT MAX(previous.id) FROM paper_chat AS previous
    WHERE previous.paper_id = paper_chat.paper_id AND previous.id < paper_chat.id
);
CREATE INDEX paper_chat_parent ON paper_chat(paper_id, parent_id, id);
CREATE TABLE paper_chat_heads (
    paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
    exchange_id INTEGER NOT NULL REFERENCES paper_chat(id) ON DELETE CASCADE
);
INSERT INTO paper_chat_heads(paper_id, exchange_id)
SELECT paper_id, MAX(id) FROM paper_chat GROUP BY paper_id;
PRAGMA user_version = 14;
