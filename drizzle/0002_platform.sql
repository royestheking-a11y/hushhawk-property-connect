ALTER TABLE plans ADD COLUMN quotas TEXT NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE plans ADD COLUMN overage TEXT NOT NULL DEFAULT 'block';
--> statement-breakpoint
UPDATE plans SET quotas = '{"sms":500,"ai":50}', overage = 'block' WHERE id = 'essential';
--> statement-breakpoint
UPDATE plans SET quotas = '{"sms":2000,"ai":500}', overage = 'allow' WHERE id = 'professional';
--> statement-breakpoint
UPDATE plans SET quotas = '{"sms":0,"ai":0}', overage = 'allow' WHERE id = 'business';
--> statement-breakpoint
CREATE TABLE secrets (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  hint TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE usage_events (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',
  detail TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX usage_company_at ON usage_events (company_id, at);
--> statement-breakpoint
CREATE TABLE phone_numbers (
  number TEXT PRIMARY KEY NOT NULL,
  company_id TEXT,
  label TEXT NOT NULL DEFAULT '',
  added_at TEXT NOT NULL,
  assigned_at TEXT
);
--> statement-breakpoint
CREATE TABLE number_requests (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  area_code TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
--> statement-breakpoint
CREATE TABLE support_requests (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'Standard',
  status TEXT NOT NULL DEFAULT 'open',
  messages TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE invoices (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  period TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  lines TEXT NOT NULL DEFAULT '[]',
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (company_id, period)
);
--> statement-breakpoint
INSERT INTO platform_settings (key,value) VALUES
  ('ai_model','claude-opus-5-5'),
  ('ai_effort','medium'),
  ('ai_instructions','You draft SMS and email replies for a property management team. Write as the property team, in plain language, under 600 characters. Never promise a repair time, refund, rent change or legal outcome. If anything suggests danger (fire, gas, flooding, carbon monoxide, threats), tell the tenant to contact emergency services now and say staff have been alerted. Only use facts from the company knowledge provided; if you do not know, say the team will follow up.'),
  ('twilio_account_sid',''),
  ('twilio_webhook_base',''),
  ('cost_sms_micros','8000'),
  ('cost_ai_input_mtok_micros','4000000'),
  ('cost_ai_output_mtok_micros','20000000'),
  ('overage_sms_cents','3'),
  ('overage_ai_cents','5');
