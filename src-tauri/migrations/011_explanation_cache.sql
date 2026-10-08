CREATE TABLE explanation_cache (
    target TEXT NOT NULL,
    context TEXT NOT NULL,
    result TEXT NOT NULL,
    PRIMARY KEY(target, context)
);
ALTER TABLE page_translations ADD COLUMN layout_version INTEGER NOT NULL DEFAULT 1;
PRAGMA user_version = 11;
