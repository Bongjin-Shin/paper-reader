CREATE TABLE ai_preferences (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    provider TEXT NOT NULL CHECK(provider IN ('api', 'chatgpt'))
);
INSERT INTO ai_preferences(id, provider) VALUES(1, 'api');
PRAGMA user_version = 9;
