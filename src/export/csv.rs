use std::fs::File;
use std::io::Write;
use std::path::Path;

use rusqlite::{params, Connection};

use crate::error::AppError;

pub fn export_year_csv(conn: &Connection, year: i32, path: &Path) -> Result<(), AppError> {
  let mut file = File::create(path)?;
  writeln!(
    file,
    "public_id,date,year,month,type,payment_method,category,description,amount_chf,mwst_rate,receipt_path,note,ref_public_id"
  )?;

  let mut stmt = conn.prepare(
    "SELECT t.public_id, t.date, t.year, t.month, t.type, t.payment_method, c.name, t.description, t.amount_chf, t.mwst_rate, t.receipt_path, t.note, t.ref_public_id
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.year = ?1
     ORDER BY t.date, t.public_id",
  )?;

  let rows = stmt.query_map(params![year], |row| {
    Ok((
      row.get::<_, String>(0)?,
      row.get::<_, String>(1)?,
      row.get::<_, i32>(2)?,
      row.get::<_, i32>(3)?,
      row.get::<_, String>(4)?,
      row.get::<_, Option<String>>(5)?,
      row.get::<_, Option<String>>(6)?,
      row.get::<_, Option<String>>(7)?,
      row.get::<_, f64>(8)?,
      row.get::<_, f64>(9)?,
      row.get::<_, Option<String>>(10)?,
      row.get::<_, Option<String>>(11)?,
      row.get::<_, Option<String>>(12)?,
    ))
  })?;

  for row in rows {
    let (public_id, date, year, month, tx_type, payment_method, category, description, amount, mwst_rate, receipt_path, note, ref_public_id) = row?;
    writeln!(
      file,
      "{},{},{},{},{},{},{},{},{},{},{},{},{}",
      escape_csv(&public_id),
      escape_csv(&date),
      year,
      month,
      escape_csv(&tx_type),
      escape_csv(payment_method.as_deref().unwrap_or("")),
      escape_csv(category.as_deref().unwrap_or("")),
      escape_csv(description.as_deref().unwrap_or("")),
      amount,
      mwst_rate,
      escape_csv(receipt_path.as_deref().unwrap_or("")),
      escape_csv(note.as_deref().unwrap_or("")),
      escape_csv(ref_public_id.as_deref().unwrap_or(""))
    )?;
  }

  Ok(())
}

fn escape_csv(value: &str) -> String {
  if value.contains(',') || value.contains('"') || value.contains('\n') {
    format!("\"{}\"", value.replace('"', "\"\""))
  } else {
    value.to_string()
  }
}
