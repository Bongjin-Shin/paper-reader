CREATE TABLE ai_preferences_new (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    provider TEXT NOT NULL CHECK(provider IN ('api', 'chatgpt', 'claude')),
    translation_model TEXT NOT NULL DEFAULT 'gpt-5.6-luna',
    chat_model TEXT NOT NULL DEFAULT '',
    chat_effort TEXT NOT NULL DEFAULT '',
    translation_effort TEXT NOT NULL DEFAULT '',
    chat_provider TEXT NOT NULL DEFAULT 'chatgpt' CHECK(chat_provider IN ('chatgpt', 'claude'))
);
INSERT INTO ai_preferences_new(id, provider, translation_model, chat_model, chat_effort, translation_effort)
SELECT id, provider, translation_model, chat_model, chat_effort, translation_effort FROM ai_preferences;
DROP TABLE ai_preferences;
ALTER TABLE ai_preferences_new RENAME TO ai_preferences;
CREATE TABLE claude_preferences (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    translation_model TEXT NOT NULL DEFAULT 'sonnet',
    translation_effort TEXT NOT NULL DEFAULT '',
    chat_model TEXT NOT NULL DEFAULT '',
    chat_effort TEXT NOT NULL DEFAULT ''
);
INSERT INTO claude_preferences(id) VALUES(1);
PRAGMA user_version = 15;
