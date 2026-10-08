-- Replace the old virtual default folder with an ordinary movable folder.
-- Preserve existing sibling folders and avoid a collision with a user-created name.
WITH RECURSIVE names(n, name) AS (
    VALUES(0, '기본 폴더')
    UNION ALL
    SELECT n + 1, '기본 폴더 (' || (n + 1) || ')' FROM names
    WHERE EXISTS(SELECT 1 FROM library_folders f WHERE f.parent_id IS NULL AND f.name = names.name COLLATE NOCASE)
)
INSERT INTO library_folders(name) SELECT name FROM names ORDER BY n DESC LIMIT 1;
UPDATE library_papers SET folder_id = last_insert_rowid() WHERE folder_id IS NULL;

ALTER TABLE papers ADD COLUMN metadata_manual INTEGER NOT NULL DEFAULT 0;
ALTER TABLE papers ADD COLUMN title_manual INTEGER NOT NULL DEFAULT 0;
UPDATE papers SET title_manual = 1 WHERE title != file_name;
PRAGMA user_version = 7;
