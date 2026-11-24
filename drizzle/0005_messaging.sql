CREATE TABLE files (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  storage TEXT NOT NULL DEFAULT 'db',
  source TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX files_owner ON files (owner_id);
--> statement-breakpoint
CREATE TABLE file_chunks (
  file_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (file_id, seq)
);
--> statement-breakpoint
INSERT INTO platform_settings (key,value) VALUES
  ('email_sender',''),
  ('email_inbound_address',''),
  ('email_stream','outbound'),
  ('alert_email','');
