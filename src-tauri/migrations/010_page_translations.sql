CREATE TABLE page_translations (
    paper_id TEXT NOT NULL REFERENCES papers(id),
    page_number INTEGER NOT NULL CHECK(page_number > 0),
    result_json TEXT NOT NULL,
    PRIMARY KEY(paper_id, page_number)
);
PRAGMA user_version = 10;
