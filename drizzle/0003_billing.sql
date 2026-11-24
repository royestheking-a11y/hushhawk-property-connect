ALTER TABLE companies ADD COLUMN profile TEXT NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE companies ADD COLUMN sub_status TEXT NOT NULL DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE companies ADD COLUMN period_start TEXT;
--> statement-breakpoint
ALTER TABLE companies ADD COLUMN period_end TEXT;
--> statement-breakpoint
ALTER TABLE companies ADD COLUMN cancel_at_period_end INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE companies ADD COLUMN pending_plan_id TEXT;
--> statement-breakpoint
ALTER TABLE companies ADD COLUMN had_trial INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE companies SET sub_status = 'active', period_start = strftime('%Y-%m-%dT%H:%M:%fZ','now'), period_end = strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 month') WHERE plan_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE plans ADD COLUMN trial_days INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE plans SET trial_days = 14 WHERE id IN ('essential','professional','business');
--> statement-breakpoint
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
--> statement-breakpoint
CREATE TABLE invoices_v2 (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  number TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'subscription',
  plan_id TEXT,
  plan_name TEXT NOT NULL DEFAULT '',
  period TEXT NOT NULL,
  period_end TEXT,
  lines TEXT NOT NULL DEFAULT '[]',
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  due_at TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO invoices_v2 (id,company_id,number,kind,plan_name,period,lines,total_cents,status,created_at,updated_at)
  SELECT id,company_id,'',CASE WHEN status = 'draft' THEN 'manual' ELSE 'manual' END,plan_name,period,lines,total_cents,CASE WHEN status = 'draft' THEN 'void' ELSE status END,created_at,updated_at FROM invoices;
--> statement-breakpoint
DROP TABLE invoices;
--> statement-breakpoint
ALTER TABLE invoices_v2 RENAME TO invoices;
--> statement-breakpoint
CREATE INDEX invoices_company ON invoices (company_id, created_at);
--> statement-breakpoint
CREATE TABLE payments (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  method TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL,
  at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE invites (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT
);
--> statement-breakpoint
CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
--> statement-breakpoint
INSERT INTO platform_settings (key,value) VALUES
  ('billing_grace_days','7'),
  ('invoice_prefix','HH'),
  ('invoice_seq','0'),
  ('seller_name','HushHawk Property Management'),
  ('seller_details',''),
  ('payment_instructions','Pay by bank transfer to the account on your welcome letter. Use the invoice number as the reference. Your workspace opens as soon as the payment is recorded.');
