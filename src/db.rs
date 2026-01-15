use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use chrono::Utc;
use rusqlite::{params, Connection};

use crate::error::AppError;
use crate::files::receipts;
use crate::settings;

pub struct Db {
  pub conn: Mutex<Connection>,
  pub db_path: PathBuf,
}

pub fn resolve_app_dir() -> Result<PathBuf, AppError> {
  if let Some(portable) = resolve_portable_dir()? {
    return Ok(portable);
  }

  let base = dirs_next::data_local_dir()
    .ok_or_else(|| AppError::new("PATH", "AppData Pfad nicht gefunden"))?;
  Ok(base.join("PizzaDamicoBuchhaltung"))
}

pub fn init_db(app_dir: &Path) -> Result<(Db, PathBuf), AppError> {
  fs::create_dir_all(app_dir)?;
  let db_path = app_dir.join("pizza_damico.sqlite");
  let mut conn = Connection::open(&db_path)?;
  conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")?;
  conn.busy_timeout(Duration::from_secs(5))?;

  run_migrations(&mut conn)?;

  let receipt_base = receipts::ensure_receipt_base(app_dir)?;
  settings::ensure_defaults(&conn, &receipt_base)?;
  seed_default_categories(&conn)?;

  Ok((
    Db {
      conn: Mutex::new(conn),
      db_path,
    },
    receipt_base,
  ))
}

pub fn with_conn<T>(db: &Db, f: impl FnOnce(&mut Connection) -> Result<T, AppError>) -> Result<T, AppError> {
  let mut guard = db.conn.lock()?;
  f(&mut guard)
}

pub fn reload_connection(db: &Db) -> Result<(), AppError> {
  let mut guard = db.conn.lock()?;
  let conn = Connection::open(&db.db_path)?;
  conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")?;
  conn.busy_timeout(Duration::from_secs(5))?;
  *guard = conn;
  Ok(())
}

pub fn checkpoint(conn: &Connection) -> Result<(), AppError> {
  conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
  Ok(())
}

fn run_migrations(conn: &mut Connection) -> Result<(), AppError> {
  conn.execute_batch(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  )?;

  apply_migration(conn, "001_init", include_str!("../migrations/001_init.sql"))?;
  Ok(())
}

fn apply_migration(conn: &mut Connection, version: &str, sql: &str) -> Result<(), AppError> {
  let exists: i64 = conn.query_row(
    "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
    params![version],
    |row| row.get(0),
  )?;
  if exists > 0 {
    return Ok(());
  }

  conn.execute_batch(sql)?;
  conn.execute(
    "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
    params![version, Utc::now().to_rfc3339()],
  )?;
  Ok(())
}

fn seed_default_categories(conn: &Connection) -> Result<(), AppError> {
  let count: i64 = conn.query_row("SELECT COUNT(*) FROM categories", [], |row| row.get(0))?;
  if count > 0 {
    return Ok(());
  }

  let defaults = vec![
    ("Lebensmittel", "Einkauf Zutaten", 2.6),
    ("Verpackung", "Boxen, Becher, Besteck", 8.1),
    ("Standplatz", "Miete, Gebuehren", 8.1),
    ("Fahrzeug", "Wartung, Treibstoff", 8.1),
    ("Marketing", "Werbung, Aktionen", 8.1),
    ("Versicherung", "Versicherungen", 8.1),
    ("Diverses", "Sonstiges", 8.1),
  ];

  for (name, description, rate) in defaults {
    conn.execute(
      "INSERT INTO categories (name, description, default_mwst_rate, is_active) VALUES (?1, ?2, ?3, 1)",
      params![name, description, rate],
    )?;
  }

  Ok(())
}

fn resolve_portable_dir() -> Result<Option<PathBuf>, AppError> {
  let env_enabled = std::env::var("PIZZA_DAMICO_PORTABLE")
    .ok()
    .map(|value| {
      let value = value.to_ascii_lowercase();
      value == "1" || value == "true" || value == "yes"
    })
    .unwrap_or(false);

  let exe_dir = std::env::current_exe()
    .ok()
    .and_then(|path| path.parent().map(|parent| parent.to_path_buf()));

  if let Some(exe_dir) = exe_dir {
    let flag = exe_dir.join("portable.flag");
    let data_dir = exe_dir.join("data");
    if env_enabled || flag.exists() || data_dir.exists() {
      fs::create_dir_all(&data_dir)?;
      return Ok(Some(data_dir));
    }
  }

  Ok(None)
}
