CREATE TABLE knowledge_docs (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'text/plain',
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ready',
  chars INTEGER NOT NULL DEFAULT 0,
  chunks INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX knowledge_docs_owner ON knowledge_docs (owner_id);
--> statement-breakpoint
CREATE VIRTUAL TABLE knowledge_chunks USING fts5(text, title UNINDEXED, owner_id UNINDEXED, doc_id UNINDEXED, seq UNINDEXED, tokenize = 'porter unicode61');
--> statement-breakpoint
CREATE TABLE ai_runs (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  thread_id TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',
  summary TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '{}',
  actor TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX ai_runs_owner ON ai_runs (owner_id, created_at);
