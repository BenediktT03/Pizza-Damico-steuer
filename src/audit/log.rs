use chrono::Utc;
use rusqlite::{params, Connection};

use crate::error::AppError;

pub fn append_audit(
  conn: &Connection,
  actor: Option<String>,
  action: &str,
  entity_type: &str,
  entity_id: Option<String>,
  ref_id: Option<String>,
  payload_json: String,
  details: Option<String>,
) -> Result<(), AppError> {
  let ts = Utc::now().to_rfc3339();
  conn.execute(
    "INSERT INTO audit_log (ts, actor, action, entity_type, entity_id, ref_id, payload_json, details) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    params![
      ts,
      actor,
      action,
      entity_type,
      entity_id,
      ref_id,
      payload_json,
      details
    ],
  )?;
  Ok(())
}
