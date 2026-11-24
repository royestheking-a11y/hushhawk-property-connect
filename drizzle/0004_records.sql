CREATE TABLE records (
  owner_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (owner_id, collection, id)
);
--> statement-breakpoint
CREATE INDEX records_owner_collection ON records (owner_id, collection);
--> statement-breakpoint
CREATE TABLE messages (
  owner_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  time TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (owner_id, id)
);
--> statement-breakpoint
CREATE INDEX messages_thread ON messages (owner_id, thread_id, time);
--> statement-breakpoint
CREATE TABLE workspace_meta (
  owner_id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE jobs (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  dedupe TEXT UNIQUE,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  run_at TEXT NOT NULL,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  finished_at TEXT
);
--> statement-breakpoint
CREATE INDEX jobs_due ON jobs (status, run_at);
--> statement-breakpoint
INSERT INTO workspace_meta (owner_id, revision, updated_at) SELECT owner_id, revision, updated_at FROM admin_workspaces;
--> statement-breakpoint
INSERT OR IGNORE INTO records (owner_id, collection, id, data, updated_at)
  SELECT w.owner_id, c.key, COALESCE(json_extract(e.value,'$.id'), c.key || '-' || e.key),
    CASE WHEN c.key = 'threads' THEN json_remove(e.value,'$.messages') ELSE e.value END, w.updated_at
  FROM admin_workspaces w, json_each(w.records) c, json_each(c.value) e
  WHERE c.type = 'array' AND c.key NOT IN ('providerEvents','audit','runs','approvals')
  ORDER BY w.owner_id, c.key, e.key;
--> statement-breakpoint
INSERT OR IGNORE INTO records (owner_id, collection, id, data, updated_at)
  SELECT w.owner_id, c.key, COALESCE(json_extract(e.value,'$.id'), c.key || '-' || e.key), e.value, w.updated_at
  FROM admin_workspaces w, json_each(w.records) c, json_each(c.value) e
  WHERE c.type = 'array' AND c.key IN ('audit','runs','approvals')
  ORDER BY w.owner_id, c.key, e.key DESC;
--> statement-breakpoint
INSERT OR IGNORE INTO records (owner_id, collection, id, data, updated_at)
  SELECT w.owner_id, 'providerEvents', e.value, json_object('id', e.value), w.updated_at
  FROM admin_workspaces w, json_each(w.records, '$.providerEvents') e;
--> statement-breakpoint
INSERT OR IGNORE INTO records (owner_id, collection, id, data, updated_at)
  SELECT w.owner_id, '_meta', c.key, c.value, w.updated_at
  FROM admin_workspaces w, json_each(w.records) c
  WHERE c.type = 'object';
--> statement-breakpoint
INSERT OR IGNORE INTO messages (owner_id, thread_id, id, data, time)
  SELECT w.owner_id, json_extract(t.value,'$.id'), COALESCE(json_extract(m.value,'$.id'), json_extract(t.value,'$.id') || '-' || m.key), m.value, COALESCE(json_extract(m.value,'$.time'),'')
  FROM admin_workspaces w, json_each(w.records, '$.threads') t, json_each(t.value, '$.messages') m
  ORDER BY w.owner_id, t.key, m.key;
