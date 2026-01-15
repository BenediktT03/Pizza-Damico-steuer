use rusqlite::{params, Connection};

use crate::error::AppError;
use crate::models::MonthStatus;

pub fn is_month_closed(conn: &Connection, year: i32, month: i32) -> Result<bool, AppError> {
  let mut stmt = conn.prepare(
    "SELECT is_closed FROM month_closing WHERE year = ?1 AND month = ?2 LIMIT 1",
  )?;
  let mut rows = stmt.query(params![year, month])?;
  if let Some(row) = rows.next()? {
    let is_closed: i64 = row.get(0)?;
    Ok(is_closed == 1)
  } else {
    Ok(false)
  }
}

pub fn get_month_status(conn: &Connection, year: i32, month: i32) -> Result<MonthStatus, AppError> {
  let mut stmt = conn.prepare(
    "SELECT is_closed, closed_at, closed_by FROM month_closing WHERE year = ?1 AND month = ?2 LIMIT 1",
  )?;
  let mut rows = stmt.query(params![year, month])?;
  if let Some(row) = rows.next()? {
    let is_closed: i64 = row.get(0)?;
    Ok(MonthStatus {
      year,
      month,
      is_closed: is_closed == 1,
      closed_at: row.get(1)?,
      closed_by: row.get(2)?,
    })
  } else {
    Ok(MonthStatus {
      year,
      month,
      is_closed: false,
      closed_at: None,
      closed_by: None,
    })
  }
}
