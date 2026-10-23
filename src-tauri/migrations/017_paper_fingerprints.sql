-- Derived from PDF pages, independent of editable Library metadata.
-- Empty fingerprints mark files that could not be parsed; those use byte identity.
CREATE TABLE IF NOT EXISTS paper_fingerprints (
    paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS paper_fingerprints_content ON paper_fingerprints(fingerprint);
PRAGMA user_version = 17;
