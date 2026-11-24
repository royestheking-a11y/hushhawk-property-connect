CREATE TABLE admin_workspaces (
  owner_id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL,
  records TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
