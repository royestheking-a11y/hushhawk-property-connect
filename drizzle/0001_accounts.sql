CREATE TABLE plans (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  support TEXT NOT NULL DEFAULT '',
  features TEXT NOT NULL,
  seats INTEGER NOT NULL DEFAULT 0,
  properties INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE companies (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  plan_id TEXT,
  overrides TEXT NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT
);
--> statement-breakpoint
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  last_login TEXT
);
--> statement-breakpoint
CREATE INDEX users_company ON users (company_id);
--> statement-breakpoint
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX sessions_user ON sessions (user_id);
--> statement-breakpoint
CREATE TABLE platform_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE platform_audit (
  id TEXT PRIMARY KEY NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT ''
);
--> statement-breakpoint
INSERT INTO plans (id,name,price_cents,description,support,features,seats,properties,active,sort,updated_at) VALUES
  ('essential','Essential',4900,'Shared inbox, contacts and maintenance tracking for small portfolios.','Email support · reply within 2 business days','["inbox","maintenance","templates"]',2,10,1,1,'2026-11-24T00:00:00.000Z'),
  ('professional','Professional',12900,'Adds voice, AI-drafted replies with approval, automation rules and reports.','Priority support · reply within 4 business hours','["inbox","voice","ai","automations","maintenance","templates","analytics"]',10,50,1,2,'2026-11-24T00:00:00.000Z'),
  ('business','Business',29900,'Everything, including integrations, team management and unlimited portfolio size.','Dedicated account manager · phone and email','["inbox","voice","ai","automations","maintenance","templates","analytics","integrations","team"]',0,0,1,3,'2026-11-24T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO platform_settings (key,value) VALUES ('ai_available','1'),('signups_open','1'),('require_approval','1');
