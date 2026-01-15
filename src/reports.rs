use rusqlite::{params, Connection};

use crate::error::AppError;
use crate::models::{CategorySplit, DailySeriesPoint, MonthSeriesPoint, PaymentSplit};

pub struct BaseKpis {
  pub income_total: f64,
  pub income_bar: f64,
  pub income_twint: f64,
  pub expense_total: f64,
  pub mwst_income: f64,
  pub mwst_expense: f64,
  pub missing_receipts_count: i64,
  pub missing_receipts_sum: f64,
}

pub fn get_month_base_kpis(conn: &Connection, year: i32, month: i32) -> Result<BaseKpis, AppError> {
  let (income_total, income_bar, income_twint, expense_total) = conn.query_row(
    "SELECT
        COALESCE(SUM(CASE WHEN type='INCOME' THEN amount_chf END), 0),
        COALESCE(SUM(CASE WHEN type='INCOME' AND payment_method='BAR' THEN amount_chf END), 0),
        COALESCE(SUM(CASE WHEN type='INCOME' AND payment_method='TWINT' THEN amount_chf END), 0),
        COALESCE(SUM(CASE WHEN type='EXPENSE' THEN amount_chf END), 0)
     FROM transactions WHERE year = ?1 AND month = ?2",
    params![year, month],
    |row| Ok((row.get::<_, f64>(0)?, row.get::<_, f64>(1)?, row.get::<_, f64>(2)?, row.get::<_, f64>(3)?)),
  )?;

  let (mwst_income, mwst_expense) = conn.query_row(
    "SELECT
        COALESCE(SUM(CASE WHEN type='INCOME' THEN amount_chf * (mwst_rate / (100.0 + mwst_rate)) END), 0),
        COALESCE(SUM(CASE WHEN type='EXPENSE' THEN amount_chf * (mwst_rate / (100.0 + mwst_rate)) END), 0)
     FROM transactions WHERE year = ?1 AND month = ?2",
    params![year, month],
    |row| Ok((row.get::<_, f64>(0)?, row.get::<_, f64>(1)?)),
  )?;

  let (missing_count, missing_sum) = conn.query_row(
    "SELECT
        COUNT(*),
        COALESCE(SUM(amount_chf), 0)
     FROM transactions
     WHERE year = ?1 AND month = ?2 AND type='EXPENSE' AND amount_chf > 0 AND (receipt_path IS NULL OR receipt_path = '')",
    params![year, month],
    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?)),
  )?;

  Ok(BaseKpis {
    income_total,
    income_bar,
    income_twint,
    expense_total,
    mwst_income,
    mwst_expense,
    missing_receipts_count: missing_count,
    missing_receipts_sum: missing_sum,
  })
}

pub fn get_year_base_kpis(conn: &Connection, year: i32) -> Result<BaseKpis, AppError> {
  let (income_total, income_bar, income_twint, expense_total) = conn.query_row(
    "SELECT
        COALESCE(SUM(CASE WHEN type='INCOME' THEN amount_chf END), 0),
        COALESCE(SUM(CASE WHEN type='INCOME' AND payment_method='BAR' THEN amount_chf END), 0),
        COALESCE(SUM(CASE WHEN type='INCOME' AND payment_method='TWINT' THEN amount_chf END), 0),
        COALESCE(SUM(CASE WHEN type='EXPENSE' THEN amount_chf END), 0)
     FROM transactions WHERE year = ?1",
    params![year],
    |row| Ok((row.get::<_, f64>(0)?, row.get::<_, f64>(1)?, row.get::<_, f64>(2)?, row.get::<_, f64>(3)?)),
  )?;

  let (mwst_income, mwst_expense) = conn.query_row(
    "SELECT
        COALESCE(SUM(CASE WHEN type='INCOME' THEN amount_chf * (mwst_rate / (100.0 + mwst_rate)) END), 0),
        COALESCE(SUM(CASE WHEN type='EXPENSE' THEN amount_chf * (mwst_rate / (100.0 + mwst_rate)) END), 0)
     FROM transactions WHERE year = ?1",
    params![year],
    |row| Ok((row.get::<_, f64>(0)?, row.get::<_, f64>(1)?)),
  )?;

  let (missing_count, missing_sum) = conn.query_row(
    "SELECT
        COUNT(*),
        COALESCE(SUM(amount_chf), 0)
     FROM transactions
     WHERE year = ?1 AND type='EXPENSE' AND amount_chf > 0 AND (receipt_path IS NULL OR receipt_path = '')",
    params![year],
    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?)),
  )?;

  Ok(BaseKpis {
    income_total,
    income_bar,
    income_twint,
    expense_total,
    mwst_income,
    mwst_expense,
    missing_receipts_count: missing_count,
    missing_receipts_sum: missing_sum,
  })
}

pub fn get_range_base_kpis(
  conn: &Connection,
  year: i32,
  month_from: i32,
  month_to: i32,
) -> Result<BaseKpis, AppError> {
  let (income_total, income_bar, income_twint, expense_total) = conn.query_row(
    "SELECT
        COALESCE(SUM(CASE WHEN type='INCOME' THEN amount_chf END), 0),
        COALESCE(SUM(CASE WHEN type='INCOME' AND payment_method='BAR' THEN amount_chf END), 0),
        COALESCE(SUM(CASE WHEN type='INCOME' AND payment_method='TWINT' THEN amount_chf END), 0),
        COALESCE(SUM(CASE WHEN type='EXPENSE' THEN amount_chf END), 0)
     FROM transactions
     WHERE year = ?1 AND month BETWEEN ?2 AND ?3",
    params![year, month_from, month_to],
    |row| Ok((row.get::<_, f64>(0)?, row.get::<_, f64>(1)?, row.get::<_, f64>(2)?, row.get::<_, f64>(3)?)),
  )?;

  let (mwst_income, mwst_expense) = conn.query_row(
    "SELECT
        COALESCE(SUM(CASE WHEN type='INCOME' THEN amount_chf * (mwst_rate / (100.0 + mwst_rate)) END), 0),
        COALESCE(SUM(CASE WHEN type='EXPENSE' THEN amount_chf * (mwst_rate / (100.0 + mwst_rate)) END), 0)
     FROM transactions
     WHERE year = ?1 AND month BETWEEN ?2 AND ?3",
    params![year, month_from, month_to],
    |row| Ok((row.get::<_, f64>(0)?, row.get::<_, f64>(1)?)),
  )?;

  let (missing_count, missing_sum) = conn.query_row(
    "SELECT
        COUNT(*),
        COALESCE(SUM(amount_chf), 0)
     FROM transactions
     WHERE year = ?1 AND month BETWEEN ?2 AND ?3 AND type='EXPENSE' AND amount_chf > 0
       AND (receipt_path IS NULL OR receipt_path = '')",
    params![year, month_from, month_to],
    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?)),
  )?;

  Ok(BaseKpis {
    income_total,
    income_bar,
    income_twint,
    expense_total,
    mwst_income,
    mwst_expense,
    missing_receipts_count: missing_count,
    missing_receipts_sum: missing_sum,
  })
}

pub fn get_daily_series(conn: &Connection, year: i32, month: i32) -> Result<Vec<DailySeriesPoint>, AppError> {
  let mut stmt = conn.prepare(
    "SELECT date,
        COALESCE(SUM(CASE WHEN type='INCOME' THEN amount_chf END), 0),
        COALESCE(SUM(CASE WHEN type='EXPENSE' THEN amount_chf END), 0)
     FROM transactions
     WHERE year = ?1 AND month = ?2
     GROUP BY date
     ORDER BY date",
  )?;
  let rows = stmt.query_map(params![year, month], |row| {
    Ok(DailySeriesPoint {
      date: row.get(0)?,
      income: row.get(1)?,
      expense: row.get(2)?,
    })
  })?;
  Ok(rows.filter_map(Result::ok).collect())
}

pub fn get_payment_split(conn: &Connection, year: i32, month: Option<i32>) -> Result<Vec<PaymentSplit>, AppError> {
  let mut data = Vec::new();
  if let Some(month) = month {
    let mut stmt = conn.prepare(
      "SELECT payment_method, COALESCE(SUM(amount_chf), 0)
       FROM transactions
       WHERE year = ?1 AND month = ?2 AND type = 'INCOME'
       GROUP BY payment_method",
    )?;
    let rows = stmt.query_map(params![year, month], |row| {
      Ok(PaymentSplit {
        payment_method: row.get::<_, Option<String>>(0)?.unwrap_or_else(|| "-".to_string()),
        amount: row.get(1)?,
      })
    })?;
    for row in rows {
      data.push(row?);
    }
  } else {
    let mut stmt = conn.prepare(
      "SELECT payment_method, COALESCE(SUM(amount_chf), 0)
       FROM transactions
       WHERE year = ?1 AND type = 'INCOME'
       GROUP BY payment_method",
    )?;
    let rows = stmt.query_map(params![year], |row| {
      Ok(PaymentSplit {
        payment_method: row.get::<_, Option<String>>(0)?.unwrap_or_else(|| "-".to_string()),
        amount: row.get(1)?,
      })
    })?;
    for row in rows {
      data.push(row?);
    }
  }

  Ok(data)
}

pub fn get_top_categories(conn: &Connection, year: i32, month: Option<i32>, limit: i64) -> Result<Vec<CategorySplit>, AppError> {
  let mut data = Vec::new();

  if let Some(month) = month {
    let mut stmt = conn.prepare(
      "SELECT COALESCE(c.name, 'Unbekannt') as name, COALESCE(SUM(t.amount_chf),0)
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.year = ?1 AND t.month = ?2 AND t.type = 'EXPENSE'
       GROUP BY c.name
       ORDER BY SUM(t.amount_chf) DESC
       LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![year, month, limit], |row| {
      Ok(CategorySplit {
        category: row.get(0)?,
        amount: row.get(1)?,
      })
    })?;
    for row in rows {
      data.push(row?);
    }
  } else {
    let mut stmt = conn.prepare(
      "SELECT COALESCE(c.name, 'Unbekannt') as name, COALESCE(SUM(t.amount_chf),0)
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.year = ?1 AND t.type = 'EXPENSE'
       GROUP BY c.name
       ORDER BY SUM(t.amount_chf) DESC
       LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![year, limit], |row| {
      Ok(CategorySplit {
        category: row.get(0)?,
        amount: row.get(1)?,
      })
    })?;
    for row in rows {
      data.push(row?);
    }
  }

  Ok(data)
}

pub fn get_month_series(conn: &Connection, year: i32) -> Result<Vec<MonthSeriesPoint>, AppError> {
  let mut stmt = conn.prepare(
    "SELECT month,
        COALESCE(SUM(CASE WHEN type='INCOME' THEN amount_chf END), 0),
        COALESCE(SUM(CASE WHEN type='EXPENSE' THEN amount_chf END), 0)
     FROM transactions
     WHERE year = ?1
     GROUP BY month
     ORDER BY month",
  )?;
  let rows = stmt.query_map(params![year], |row| {
    let income: f64 = row.get(1)?;
    let expense: f64 = row.get(2)?;
    Ok(MonthSeriesPoint {
      month: row.get(0)?,
      income,
      expense,
      result: income - expense,
    })
  })?;
  Ok(rows.filter_map(Result::ok).collect())
}
