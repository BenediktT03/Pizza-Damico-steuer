use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{Datelike, NaiveDate};
use rusqlite::{params, Connection};
use rust_xlsxwriter::{Color, ExcelDateTime, Format, FormatAlign, Url, Workbook, Worksheet};

use crate::domain::mwst;
use crate::error::AppError;
use crate::models::YearKpis;
use crate::reports;

const EXPORT_RECEIPTS_DIR: &str = "Belege";

struct ReceiptExport {
  receipts_dir: PathBuf,
  copied: HashMap<String, String>,
}

impl ReceiptExport {
  fn new(receipts_dir: PathBuf) -> Result<Self, AppError> {
    fs::create_dir_all(&receipts_dir)?;
    Ok(Self {
      receipts_dir,
      copied: HashMap::new(),
    })
  }

  fn link_for(&mut self, receipt_path: &str, year: i32, month: i32) -> Result<Option<(String, String)>, AppError> {
    let trimmed = receipt_path.trim();
    if trimmed.is_empty() {
      return Ok(None);
    }
    let cache_key = format!("{trimmed}::{year}-{month:02}");
    if let Some(existing) = self.copied.get(&cache_key) {
      let display = Path::new(existing)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(existing)
        .to_string();
      return Ok(Some((format!("file:///{}", existing), display)));
    }

    let source = Path::new(trimmed);
    if !source.exists() {
      return Ok(None);
    }

    let file_name = source.file_name().and_then(|name| name.to_str()).unwrap_or("beleg");
    let month_dir = self.receipts_dir.join(format!("{year}")).join(format!("{month:02}"));
    fs::create_dir_all(&month_dir)?;
    let candidate = unique_receipt_path(&month_dir, file_name);
    fs::copy(source, &candidate)?;
    let relative = format!(
      "{}/{}/{:02}/{}",
      EXPORT_RECEIPTS_DIR,
      year,
      month,
      candidate.file_name().and_then(|name| name.to_str()).unwrap_or("beleg")
    );
    let relative = relative.replace('\\', "/");
    self.copied.insert(cache_key, relative.clone());
    Ok(Some((format!("file:///{}", relative), file_name.to_string())))
  }
}

fn unique_receipt_path(base_dir: &Path, file_name: &str) -> PathBuf {
  let mut candidate = base_dir.join(file_name);
  if !candidate.exists() {
    return candidate;
  }
  let stem = Path::new(file_name)
    .file_stem()
    .and_then(|value| value.to_str())
    .unwrap_or("beleg");
  let ext = Path::new(file_name).extension().and_then(|value| value.to_str()).unwrap_or("");
  let mut counter = 1;
  loop {
    let next_name = if ext.is_empty() {
      format!("{stem}_{counter}")
    } else {
      format!("{stem}_{counter}.{ext}")
    };
    candidate = base_dir.join(next_name);
    if !candidate.exists() {
      return candidate;
    }
    counter += 1;
  }
}

pub fn export_year(conn: &Connection, year: i32, path: &Path, receipts_dir: Option<&Path>) -> Result<(), AppError> {
  let mut workbook = Workbook::new();
  write_year_sheet(&mut workbook, conn, year)?;
  let mut receipt_export = if let Some(dir) = receipts_dir {
    Some(ReceiptExport::new(dir.to_path_buf())?)
  } else {
    None
  };

  for month in 1..=12 {
    write_month_sheet(&mut workbook, conn, year, month, receipt_export.as_mut())?;
  }

  workbook
    .save(path)
    .map_err(|err| AppError::new("EXPORT", err.to_string()))?;
  Ok(())
}

pub fn export_month(
  conn: &Connection,
  year: i32,
  month: i32,
  path: &Path,
  receipts_dir: Option<&Path>,
) -> Result<(), AppError> {
  let mut workbook = Workbook::new();
  let mut receipt_export = if let Some(dir) = receipts_dir {
    Some(ReceiptExport::new(dir.to_path_buf())?)
  } else {
    None
  };
  write_month_sheet(&mut workbook, conn, year, month, receipt_export.as_mut())?;
  workbook
    .save(path)
    .map_err(|err| AppError::new("EXPORT", err.to_string()))?;
  Ok(())
}

pub fn export_range(
  conn: &Connection,
  year: i32,
  month_from: i32,
  month_to: i32,
  path: &Path,
  receipts_dir: Option<&Path>,
) -> Result<(), AppError> {
  let mut workbook = Workbook::new();
  write_range_sheet(&mut workbook, conn, year, month_from, month_to)?;
  let mut receipt_export = if let Some(dir) = receipts_dir {
    Some(ReceiptExport::new(dir.to_path_buf())?)
  } else {
    None
  };

  for month in month_from..=month_to {
    write_month_sheet(&mut workbook, conn, year, month, receipt_export.as_mut())?;
  }

  workbook
    .save(path)
    .map_err(|err| AppError::new("EXPORT", err.to_string()))?;
  Ok(())
}

fn write_year_sheet(workbook: &mut Workbook, conn: &Connection, year: i32) -> Result<(), AppError> {
  let base = reports::get_year_base_kpis(conn, year)?;
  let result = base.income_total - base.expense_total;
  let margin = mwst::safe_margin(result, base.income_total);
  let kpis = YearKpis {
    income_total: base.income_total,
    income_bar: base.income_bar,
    income_twint: base.income_twint,
    expense_total: base.expense_total,
    result,
    margin,
    mwst_income: base.mwst_income,
    mwst_expense: base.mwst_expense,
    mwst_due: base.mwst_income - base.mwst_expense,
    missing_receipts_count: base.missing_receipts_count,
    missing_receipts_sum: base.missing_receipts_sum,
  };

  let sheet = workbook.add_worksheet();
  sheet
    .set_name("JAHR")
    .map_err(|err| AppError::new("EXPORT", err.to_string()))?;

  let header = Format::new()
    .set_bold()
    .set_font_color(Color::White)
    .set_background_color(Color::RGB(0x1A2433));
  let label = Format::new().set_bold();
  let money = Format::new().set_num_format("[$CHF] #,##0.00");
  let percent = Format::new().set_num_format("0.00%");

  sheet.merge_range(0, 0, 0, 3, &format!("Jahresuebersicht {year}"), &header)?;

  let rows = vec![
    ("Einnahmen Total", kpis.income_total),
    ("Einnahmen BAR", kpis.income_bar),
    ("Einnahmen TWINT", kpis.income_twint),
    ("Ausgaben Total", kpis.expense_total),
    ("Ergebnis", kpis.result),
    ("Marge", kpis.margin),
    ("MWST Einnahmen", kpis.mwst_income),
    ("MWST Ausgaben", kpis.mwst_expense),
    ("MWST Zahllast", kpis.mwst_due),
    ("Missing Receipts Summe", kpis.missing_receipts_sum),
  ];

  let mut row = 2;
  for (label_text, value) in rows {
    sheet.write_string_with_format(row, 0, label_text, &label)?;
    if label_text == "Marge" {
      sheet.write_number_with_format(row, 1, value, &percent)?;
    } else {
      sheet.write_number_with_format(row, 1, value, &money)?;
    }
    row += 1;
  }

  sheet.set_column_width(0, 28)?;
  sheet.set_column_width(1, 18)?;
  Ok(())
}

fn write_range_sheet(
  workbook: &mut Workbook,
  conn: &Connection,
  year: i32,
  month_from: i32,
  month_to: i32,
) -> Result<(), AppError> {
  let base = reports::get_range_base_kpis(conn, year, month_from, month_to)?;
  let result = base.income_total - base.expense_total;
  let margin = mwst::safe_margin(result, base.income_total);
  let kpis = YearKpis {
    income_total: base.income_total,
    income_bar: base.income_bar,
    income_twint: base.income_twint,
    expense_total: base.expense_total,
    result,
    margin,
    mwst_income: base.mwst_income,
    mwst_expense: base.mwst_expense,
    mwst_due: base.mwst_income - base.mwst_expense,
    missing_receipts_count: base.missing_receipts_count,
    missing_receipts_sum: base.missing_receipts_sum,
  };

  let sheet = workbook.add_worksheet();
  sheet
    .set_name("ZEITRAUM")
    .map_err(|err| AppError::new("EXPORT", err.to_string()))?;

  let header = Format::new()
    .set_bold()
    .set_font_color(Color::White)
    .set_background_color(Color::RGB(0x1A2433));
  let label = Format::new().set_bold();
  let money = Format::new().set_num_format("[$CHF] #,##0.00");
  let percent = Format::new().set_num_format("0.00%");

  sheet.merge_range(
    0,
    0,
    0,
    3,
    &format!("Zeitraum {year} {month_from:02}-{month_to:02}"),
    &header,
  )?;

  let rows = vec![
    ("Einnahmen Total", kpis.income_total),
    ("Einnahmen BAR", kpis.income_bar),
    ("Einnahmen TWINT", kpis.income_twint),
    ("Ausgaben Total", kpis.expense_total),
    ("Ergebnis", kpis.result),
    ("Marge", kpis.margin),
    ("MWST Einnahmen", kpis.mwst_income),
    ("MWST Ausgaben", kpis.mwst_expense),
    ("MWST Zahllast", kpis.mwst_due),
    ("Missing Receipts Summe", kpis.missing_receipts_sum),
  ];

  let mut row = 2;
  for (label_text, value) in rows {
    sheet.write_string_with_format(row, 0, label_text, &label)?;
    if label_text == "Marge" {
      sheet.write_number_with_format(row, 1, value, &percent)?;
    } else {
      sheet.write_number_with_format(row, 1, value, &money)?;
    }
    row += 1;
  }

  sheet.set_column_width(0, 28)?;
  sheet.set_column_width(1, 18)?;
  Ok(())
}

fn write_month_sheet(
  workbook: &mut Workbook,
  conn: &Connection,
  year: i32,
  month: i32,
  mut receipt_export: Option<&mut ReceiptExport>,
) -> Result<(), AppError> {
  let month_name = match month {
    1 => "JAN",
    2 => "FEB",
    3 => "MAR",
    4 => "APR",
    5 => "MAI",
    6 => "JUN",
    7 => "JUL",
    8 => "AUG",
    9 => "SEP",
    10 => "OKT",
    11 => "NOV",
    12 => "DEZ",
    _ => "MON",
  };

  let mut sheet = workbook.add_worksheet();
  sheet
    .set_name(month_name)
    .map_err(|err| AppError::new("EXPORT", err.to_string()))?;

  let header = Format::new()
    .set_bold()
    .set_background_color(Color::RGB(0xE2E8F0))
    .set_align(FormatAlign::Center);
  let title = Format::new().set_bold().set_font_size(14.0);
  let money = Format::new().set_num_format("[$CHF] #,##0.00");
  let percent = Format::new().set_num_format("0.0\"%\"");
  let date_format = Format::new().set_num_format("dd.mm.yyyy");

  sheet.write_string_with_format(0, 0, &format!("{month_name} {year}"), &title)?;

  let income_headers = [
    "ID",
    "Datum",
    "Zahlungsart",
    "Betrag CHF",
    "MWST %",
    "MWST CHF",
    "Notiz",
  ];
  for (idx, label) in income_headers.iter().enumerate() {
    sheet.write_string_with_format(2, idx as u16, *label, &header)?;
  }

  let mut row = 3;
  let mut stmt = conn.prepare(
    "SELECT public_id, date, payment_method, amount_chf, mwst_rate, note
     FROM transactions
     WHERE year = ?1 AND month = ?2 AND type = 'INCOME'
     ORDER BY date, public_id",
  )?;
  let income_iter = stmt.query_map(params![year, month], |row| {
    Ok((
      row.get::<_, String>(0)?,
      row.get::<_, String>(1)?,
      row.get::<_, Option<String>>(2)?,
      row.get::<_, f64>(3)?,
      row.get::<_, f64>(4)?,
      row.get::<_, Option<String>>(5)?,
    ))
  })?;

  for item in income_iter {
    let (public_id, date, payment_method, amount, mwst_rate, note) = item?;
    sheet.write_string(row, 0, &public_id)?;
    write_date(&mut sheet, row, 1, &date, &date_format)?;
    sheet.write_string(row, 2, payment_method.as_deref().unwrap_or(""))?;
    sheet.write_number_with_format(row, 3, amount, &money)?;
    sheet.write_number_with_format(row, 4, mwst_rate, &percent)?;
    let mwst_chf = mwst::mwst_from_brutto(amount, mwst_rate);
    sheet.write_number_with_format(row, 5, mwst_chf, &money)?;
    sheet.write_string(row, 6, note.as_deref().unwrap_or(""))?;
    row += 1;
  }

  let expense_start = row + 1;
  sheet.write_string_with_format(expense_start, 0, "Ausgaben", &title)?;

  let expense_headers = [
    "ID",
    "Datum",
    "Kategorie",
    "Beschreibung",
    "Betrag CHF",
    "MWST %",
    "MWST CHF",
    "Beleg",
    "Notiz",
    "RefID",
  ];

  for (idx, label) in expense_headers.iter().enumerate() {
    sheet.write_string_with_format(expense_start + 1, idx as u16, *label, &header)?;
  }

  let mut row = expense_start + 2;
  let mut stmt = conn.prepare(
    "SELECT t.public_id, t.date, c.name, t.description, t.amount_chf, t.mwst_rate, t.receipt_path, t.note, t.ref_public_id
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.year = ?1 AND t.month = ?2 AND t.type = 'EXPENSE'
     ORDER BY t.date, t.public_id",
  )?;
  let expense_iter = stmt.query_map(params![year, month], |row| {
    Ok((
      row.get::<_, String>(0)?,
      row.get::<_, String>(1)?,
      row.get::<_, Option<String>>(2)?,
      row.get::<_, Option<String>>(3)?,
      row.get::<_, f64>(4)?,
      row.get::<_, f64>(5)?,
      row.get::<_, Option<String>>(6)?,
      row.get::<_, Option<String>>(7)?,
      row.get::<_, Option<String>>(8)?,
    ))
  })?;

  for item in expense_iter {
    let (public_id, date, category, description, amount, mwst_rate, receipt_path, note, ref_id) = item?;
    sheet.write_string(row, 0, &public_id)?;
    write_date(&mut sheet, row, 1, &date, &date_format)?;
    sheet.write_string(row, 2, category.as_deref().unwrap_or(""))?;
    sheet.write_string(row, 3, description.as_deref().unwrap_or(""))?;
    sheet.write_number_with_format(row, 4, amount, &money)?;
    sheet.write_number_with_format(row, 5, mwst_rate, &percent)?;
    let mwst_chf = mwst::mwst_from_brutto(amount, mwst_rate);
    sheet.write_number_with_format(row, 6, mwst_chf, &money)?;
    let mut receipt_written = false;
    if let Some(path) = receipt_path.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
      if let Some(exporter) = receipt_export.as_deref_mut() {
        if let Some((link, text)) = exporter.link_for(path, year, month)? {
          sheet.write_url_with_text(row, 7, Url::new(link), text)?;
          receipt_written = true;
        }
      } else {
        sheet.write_string(row, 7, path)?;
        receipt_written = true;
      }
    }
    if !receipt_written {
      sheet.write_string(row, 7, "fehlt")?;
    }
    sheet.write_string(row, 8, note.as_deref().unwrap_or(""))?;
    sheet.write_string(row, 9, ref_id.as_deref().unwrap_or(""))?;
    row += 1;
  }

  sheet.set_column_width(0, 12)?;
  sheet.set_column_width(1, 12)?;
  sheet.set_column_width(2, 18)?;
  sheet.set_column_width(3, 26)?;
  sheet.set_column_width(4, 14)?;
  sheet.set_column_width(5, 10)?;
  sheet.set_column_width(6, 14)?;
  sheet.set_column_width(7, 34)?;
  sheet.set_column_width(8, 24)?;
  sheet.set_column_width(9, 12)?;

  if row > 3 {
    sheet.autofilter(2, 0, row - 1, 9)?;
  }
  sheet.set_freeze_panes(3, 0)?;
  Ok(())
}

fn write_date(sheet: &mut Worksheet, row: u32, col: u16, date: &str, format: &Format) -> Result<(), AppError> {
  let parsed = NaiveDate::parse_from_str(date, "%Y-%m-%d")
    .map_err(|_| AppError::new("INVALID_DATE", "Ungueltiges Datum"))?;
  let year = u16::try_from(parsed.year()).map_err(|_| AppError::new("INVALID_DATE", "Ungueltiges Datum"))?;
  let date = ExcelDateTime::from_ymd(year, parsed.month() as u8, parsed.day() as u8)
    .map_err(|err| AppError::new("EXPORT", err.to_string()))?;
  sheet.write_datetime_with_format(row, col, &date, format)?;
  Ok(())
}
