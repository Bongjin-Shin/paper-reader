CREATE TABLE api_credit (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    initial_nano_usd INTEGER CHECK (initial_nano_usd >= 0)
);
INSERT INTO api_credit(id, initial_nano_usd) VALUES (1, NULL);
CREATE TABLE api_usage (
    id INTEGER PRIMARY KEY,
    response_id TEXT UNIQUE,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
    cached_input_tokens INTEGER NOT NULL CHECK (cached_input_tokens >= 0),
    cache_write_tokens INTEGER NOT NULL CHECK (cache_write_tokens >= 0),
    output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
    estimated_tokens INTEGER NOT NULL CHECK (estimated_tokens IN (0, 1)),
    pricing_json TEXT NOT NULL,
    cost_nano_usd INTEGER NOT NULL CHECK (cost_nano_usd >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
PRAGMA user_version = 2;
