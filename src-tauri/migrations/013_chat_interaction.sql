ALTER TABLE ai_preferences ADD COLUMN translation_effort TEXT NOT NULL DEFAULT '';
ALTER TABLE paper_chat ADD COLUMN followups_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE paper_chat ADD COLUMN interrupted INTEGER NOT NULL DEFAULT 0;
PRAGMA user_version = 13;
