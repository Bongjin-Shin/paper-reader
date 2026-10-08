ALTER TABLE highlights ADD COLUMN color TEXT NOT NULL DEFAULT 'yellow'
    CHECK (color IN ('yellow', 'green', 'blue', 'pink', 'purple'));
CREATE TABLE reader_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    highlight_color TEXT NOT NULL DEFAULT 'yellow'
        CHECK (highlight_color IN ('yellow', 'green', 'blue', 'pink', 'purple'))
);
INSERT INTO reader_settings(id) VALUES (1);
PRAGMA user_version = 4;
