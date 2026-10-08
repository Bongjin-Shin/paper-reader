ALTER TABLE vocabulary_entries ADD COLUMN lookup_count INTEGER NOT NULL DEFAULT 0 CHECK (lookup_count >= 0);
-- Phase 1 recorded one context for every completed word lookup, including repeats.
UPDATE vocabulary_entries SET lookup_count = (
    SELECT COUNT(*) FROM vocabulary_contexts WHERE vocabulary_entry_id = vocabulary_entries.id
);
CREATE INDEX contexts_cache ON vocabulary_contexts(vocabulary_entry_id, original_sentence, action_type, id DESC);
CREATE INDEX contexts_paper_entry ON vocabulary_contexts(paper_id, vocabulary_entry_id);
PRAGMA user_version = 3;
