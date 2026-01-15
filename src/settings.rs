use std::path::Path;

use chrono::Datelike;
use rusqlite::{params, Connection};

use crate::error::AppError;
use crate::models::Settings;

const KEY_YEAR: &str = "current_year";
const KEY_MWST_MODE: &str = "mwst_mode";
const KEY_MWST_SALDO: &str = "mwst_saldo_rate";
const KEY_RECEIPT_BASE: &str = "receipt_base_folder";

pub fn ensure_defaults(conn: &Connection, receipt_base: &Path) -> Result<(), AppError> {
  let year = chrono::Utc::now().year();
  conn.execute(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
    params![KEY_YEAR, year.to_string()],
  )?;
  conn.execute(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
    params![KEY_MWST_MODE, "EFFEKTIV"],
  )?;
  conn.execute(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
    params![KEY_MWST_SALDO, "5.9"],
  )?;
  conn.execute(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
    params![KEY_RECEIPT_BASE, receipt_base.to_string_lossy().to_string()],
  )?;
  Ok(())
}

pub fn get_settings(conn: &Connection) -> Result<Settings, AppError> {
  let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
  let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;

  let mut current_year = chrono::Utc::now().year();
  let mut mwst_mode = "EFFEKTIV".to_string();
  let mut mwst_saldo_rate = 5.9_f64;
  let mut receipt_base_folder = String::new();

  for row in rows {
    let (key, value) = row?;
    match key.as_str() {
      KEY_YEAR => {
        current_year = value.parse().unwrap_or(current_year);
      }
      KEY_MWST_MODE => {
        mwst_mode = value;
      }
      KEY_MWST_SALDO => {
        mwst_saldo_rate = value.parse().unwrap_or(mwst_saldo_rate);
      }
      KEY_RECEIPT_BASE => {
        receipt_base_folder = value;
      }
      _ => {}
    }
  }

  Ok(Settings {
    current_year,
    mwst_mode,
    mwst_saldo_rate,
    receipt_base_folder,
  })
}

pub fn update_settings(conn: &Connection, settings: &Settings) -> Result<(), AppError> {
  conn.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
    params![KEY_YEAR, settings.current_year.to_string()],
  )?;
  conn.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
    params![KEY_MWST_MODE, settings.mwst_mode.clone()],
  )?;
  conn.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
    params![KEY_MWST_SALDO, settings.mwst_saldo_rate.to_string()],
  )?;
  conn.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
    params![KEY_RECEIPT_BASE, settings.receipt_base_folder.clone()],
  )?;
  Ok(())
}
