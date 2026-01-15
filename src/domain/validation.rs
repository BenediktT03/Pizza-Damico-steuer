use chrono::NaiveDate;

use crate::error::AppError;

pub fn parse_date(date: &str) -> Result<NaiveDate, AppError> {
  NaiveDate::parse_from_str(date, "%Y-%m-%d")
    .map_err(|_| AppError::new("INVALID_DATE", "Datum muss YYYY-MM-DD sein"))
}

pub fn ensure_amount_positive(amount: f64) -> Result<(), AppError> {
  if amount <= 0.0 {
    Err(AppError::new("INVALID_AMOUNT", "Betrag muss > 0 sein"))
  } else {
    Ok(())
  }
}

pub fn ensure_mwst_rate(rate: f64) -> Result<(), AppError> {
  if !(0.0..100.0).contains(&rate) {
    Err(AppError::new("INVALID_MWST", "MWST Satz muss zwischen 0 und 100 liegen"))
  } else {
    Ok(())
  }
}
