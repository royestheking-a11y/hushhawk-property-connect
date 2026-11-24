ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN mfa_secret TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE users ADD COLUMN mfa_pending TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE users ADD COLUMN mfa_recovery TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE users ADD COLUMN mfa_last_step INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN terms_accepted_at TEXT;
--> statement-breakpoint
ALTER TABLE companies ADD COLUMN require_mfa INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE companies ADD COLUMN retention_months INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE companies ADD COLUMN deletion_requested_at TEXT;
--> statement-breakpoint
CREATE TABLE mfa_challenges (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  remember INTEGER NOT NULL DEFAULT 1,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE leads (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  units TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO platform_settings (key,value) VALUES ('require_mfa_super','0');
--> statement-breakpoint
UPDATE users SET terms_accepted_at = created_at WHERE terms_accepted_at IS NULL;
