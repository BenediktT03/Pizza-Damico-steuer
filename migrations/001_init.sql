CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  default_mwst_rate REAL NOT NULL DEFAULT 0.0,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  type TEXT NOT NULL CHECK(type IN ('INCOME', 'EXPENSE', 'CORRECTION')),
  payment_method TEXT CHECK(payment_method IN ('BAR', 'TWINT')),
  category_id INTEGER,
  description TEXT,
  amount_chf REAL NOT NULL CHECK(amount_chf <> 0),
  mwst_rate REAL NOT NULL CHECK(mwst_rate >= 0 AND mwst_rate < 100),
  receipt_path TEXT,
  note TEXT,
  ref_public_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS month_closing (
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  is_closed INTEGER NOT NULL DEFAULT 0,
  closed_at TEXT,
  closed_by TEXT,
  PRIMARY KEY(year, month)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  ref_id TEXT,
  payload_json TEXT NOT NULL,
  details TEXT
);

CREATE INDEX IF NOT EXISTS idx_transactions_year_month_date ON transactions(year, month, date);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_public_id ON transactions(public_id);
CREATE INDEX IF NOT EXISTS idx_transactions_ref_public_id ON transactions(ref_public_id);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
