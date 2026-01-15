use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use base64::Engine;
use chrono::{Datelike, Duration, NaiveDate, Utc};
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

use crate::audit::log::append_audit;
use crate::db;
use crate::domain::{closing, mwst, validation};
use crate::error::AppError;
use crate::export::{csv, excel};
use crate::files::{backup, receipts};
use crate::models::*;
use crate::reports;
use crate::settings;
use crate::sync;
use crate::AppState;

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<Settings, AppError> {
  db::with_conn(&state.db, |conn| {
    let mut settings = settings::get_settings(conn)?;
    if settings.receipt_base_folder.trim().is_empty()
      || !PathBuf::from(&settings.receipt_base_folder).exists()
    {
      settings.receipt_base_folder = state.receipt_base.to_string_lossy().to_string();
    }
    Ok(settings)
  })
}

#[tauri::command]
pub fn update_settings(state: State<AppState>, settings_input: Settings, actor: Option<String>) -> Result<Settings, AppError> {
  let receipt_path = PathBuf::from(&settings_input.receipt_base_folder);
  if !settings_input.receipt_base_folder.trim().is_empty() {
    fs::create_dir_all(&receipt_path)?;
  }

  db::with_conn(&state.db, |conn| {
    settings::update_settings(conn, &settings_input)?;
    append_audit(
      conn,
      actor,
      "UPDATE_SETTINGS",
      "SETTINGS",
      None,
      None,
      serde_json::to_string(&settings_input).unwrap_or_else(|_| "{}".to_string()),
      None,
    )?;
    Ok(settings_input)
  })
}

#[tauri::command]
pub fn list_categories(state: State<AppState>) -> Result<Vec<Category>, AppError> {
  db::with_conn(&state.db, |conn| {
    let mut stmt = conn.prepare(
      "SELECT id, name, description, default_mwst_rate, is_active FROM categories ORDER BY name",
    )?;
    let rows = stmt.query_map([], |row| {
      Ok(Category {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        default_mwst_rate: row.get(3)?,
        is_active: row.get::<_, i64>(4)? == 1,
      })
    })?;

    Ok(rows.filter_map(Result::ok).collect())
  })
}

#[tauri::command]
pub fn create_category(state: State<AppState>, input: CategoryInput, actor: Option<String>) -> Result<Category, AppError> {
  db::with_conn(&state.db, |conn| {
    let payload_json = serde_json::to_string(&input).unwrap_or_else(|_| "{}".to_string());
    let CategoryInput {
      name,
      description,
      default_mwst_rate,
    } = input;
    conn.execute(
      "INSERT INTO categories (name, description, default_mwst_rate, is_active) VALUES (?1, ?2, ?3, 1)",
      params![name, description, default_mwst_rate],
    )?;
    let id = conn.last_insert_rowid();
    append_audit(
      conn,
      actor,
      "CATEGORY_UPDATE",
      "CATEGORY",
      Some(id.to_string()),
      None,
      payload_json,
      None,
    )?;
    Ok(Category {
      id,
      name,
      description,
      default_mwst_rate,
      is_active: true,
    })
  })
}

#[tauri::command]
pub fn update_category(state: State<AppState>, input: CategoryUpdateInput, actor: Option<String>) -> Result<Category, AppError> {
  db::with_conn(&state.db, |conn| {
    let payload_json = serde_json::to_string(&input).unwrap_or_else(|_| "{}".to_string());
    let CategoryUpdateInput {
      id,
      name,
      description,
      default_mwst_rate,
      is_active,
    } = input;
    conn.execute(
      "UPDATE categories SET name = ?1, description = ?2, default_mwst_rate = ?3, is_active = ?4 WHERE id = ?5",
      params![name, description, default_mwst_rate, if is_active {1} else {0}, id],
    )?;
    append_audit(
      conn,
      actor,
      "CATEGORY_UPDATE",
      "CATEGORY",
      Some(id.to_string()),
      None,
      payload_json,
      None,
    )?;
    Ok(Category {
      id,
      name,
      description,
      default_mwst_rate,
      is_active,
    })
  })
}

#[tauri::command]
pub fn deactivate_category(state: State<AppState>, id: i64, actor: Option<String>) -> Result<(), AppError> {
  db::with_conn(&state.db, |conn| {
    conn.execute("UPDATE categories SET is_active = 0 WHERE id = ?1", params![id])?;
    append_audit(
      conn,
      actor,
      "CATEGORY_UPDATE",
      "CATEGORY",
      Some(id.to_string()),
      None,
      "{\"action\":\"deactivate\"}".to_string(),
      None,
    )?;
    Ok(())
  })
}

#[tauri::command]
pub fn create_income(state: State<AppState>, input: NewIncomeInput, actor: Option<String>) -> Result<TransactionListItem, AppError> {
  let payload_json = serde_json::to_string(&input).unwrap_or_else(|_| "{}".to_string());
  let date = validation::parse_date(&input.date)?;
  validation::ensure_amount_positive(input.amount_chf)?;
  validation::ensure_mwst_rate(input.mwst_rate)?;
  if input.payment_method != "BAR" && input.payment_method != "TWINT" {
    return Err(AppError::new("INVALID_PAYMENT", "Zahlungsart muss BAR oder TWINT sein"));
  }

  let (year, month) = (date.year(), date.month() as i32);

  db::with_conn(&state.db, |conn| {
    if closing::is_month_closed(conn, year, month)? {
      return Err(AppError::new("MONTH_CLOSED", "Monat abgeschlossen"));
    }

    if !input.allow_duplicate.unwrap_or(false) {
      if let Some(dup) = check_duplicate_income(conn, date, input.amount_chf, &input.payment_method, input.note.as_deref())? {
        return Err(AppError::new(
          "DUPLICATE_WARNING",
          format!("Moeglicher Doppel-Eintrag: {dup}"),
        ));
      }
    }

    let tx = conn.transaction()?;
    let public_id = next_public_id(&tx)?;
    let now = Utc::now().to_rfc3339();

    tx.execute(
      "INSERT INTO transactions (public_id, date, year, month, type, payment_method, category_id, description, amount_chf, mwst_rate, receipt_path, note, ref_public_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'INCOME', ?5, NULL, NULL, ?6, ?7, NULL, ?8, NULL, ?9, ?10)",
      params![
        public_id,
        input.date,
        year,
        month,
        input.payment_method,
        input.amount_chf,
        input.mwst_rate,
        input.note.clone(),
        now,
        now
      ],
    )?;

    append_audit(
      &tx,
      actor,
      "CREATE_TX",
      "TRANSACTION",
      Some(public_id.clone()),
      None,
      payload_json,
      None,
    )?;

    tx.commit()?;
    fetch_transaction_by_public_id(conn, &public_id)
  })
}

#[tauri::command]
pub fn create_expense(state: State<AppState>, input: NewExpenseInput, actor: Option<String>) -> Result<TransactionListItem, AppError> {
  let payload_json = serde_json::to_string(&input).unwrap_or_else(|_| "{}".to_string());
  let date = validation::parse_date(&input.date)?;
  validation::ensure_amount_positive(input.amount_chf)?;

  let (year, month) = (date.year(), date.month() as i32);

  db::with_conn(&state.db, |conn| {
    if closing::is_month_closed(conn, year, month)? {
      return Err(AppError::new("MONTH_CLOSED", "Monat abgeschlossen"));
    }

    let (default_mwst, is_active): (f64, i64) = conn.query_row(
      "SELECT default_mwst_rate, is_active FROM categories WHERE id = ?1",
      params![input.category_id],
      |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if is_active == 0 {
      return Err(AppError::new("CATEGORY_INACTIVE", "Kategorie ist deaktiviert"));
    }

    let mwst_rate = input.mwst_rate.unwrap_or(default_mwst);
    validation::ensure_mwst_rate(mwst_rate)?;

    if !input.allow_duplicate.unwrap_or(false) {
      if let Some(dup) = check_duplicate_expense(conn, date, input.amount_chf, input.category_id, input.description.as_deref())? {
        return Err(AppError::new(
          "DUPLICATE_WARNING",
          format!("Moeglicher Doppel-Eintrag: {dup}"),
        ));
      }
    }

    let tx = conn.transaction()?;
    let public_id = next_public_id(&tx)?;
    let now = Utc::now().to_rfc3339();

    let final_receipt = if let Some(source) = input.receipt_source_path.as_deref() {
      let settings = settings::get_settings(&tx)?;
      let base_folder = resolve_receipt_base(&settings, &state);
      Some(receipts::copy_receipt(source, &base_folder, year, month, &public_id)?)
    } else {
      None
    };

    tx.execute(
      "INSERT INTO transactions (public_id, date, year, month, type, payment_method, category_id, description, amount_chf, mwst_rate, receipt_path, note, ref_public_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'EXPENSE', NULL, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?12)",
      params![
        public_id,
        input.date,
        year,
        month,
        input.category_id,
        input.description.clone(),
        input.amount_chf,
        mwst_rate,
        final_receipt,
        input.note.clone(),
        now,
        now
      ],
    )?;

    append_audit(
      &tx,
      actor,
      "CREATE_TX",
      "TRANSACTION",
      Some(public_id.clone()),
      None,
      payload_json,
      None,
    )?;

    tx.commit()?;
    fetch_transaction_by_public_id(conn, &public_id)
  })
}

#[tauri::command]
pub fn create_storno(state: State<AppState>, input: StornoInput, actor: Option<String>) -> Result<TransactionListItem, AppError> {
  let payload_json = serde_json::to_string(&input).unwrap_or_else(|_| "{}".to_string());
  let date = validation::parse_date(&input.date)?;
  let (year, month) = (date.year(), date.month() as i32);

  db::with_conn(&state.db, |conn| {
    if closing::is_month_closed(conn, year, month)? {
      return Err(AppError::new("MONTH_CLOSED", "Monat abgeschlossen"));
    }

    let original = {
      let mut stmt = conn.prepare(
        "SELECT public_id, type, payment_method, category_id, description, amount_chf, mwst_rate, note
       FROM transactions WHERE public_id = ?1",
      )?;
      stmt.query_row(params![input.public_id], |row| {
        Ok((
          row.get::<_, String>(0)?,
          row.get::<_, String>(1)?,
          row.get::<_, Option<String>>(2)?,
          row.get::<_, Option<i64>>(3)?,
          row.get::<_, Option<String>>(4)?,
          row.get::<_, f64>(5)?,
          row.get::<_, f64>(6)?,
          row.get::<_, Option<String>>(7)?,
        ))
      })?
    };

    if original.5 < 0.0 {
      return Err(AppError::new("STORNO_INVALID", "Storno auf Storno nicht erlaubt"));
    }

    let amount = input.amount_chf.unwrap_or(original.5).abs();
    let storno_amount = -amount;

    let tx = conn.transaction()?;
    let public_id = next_public_id(&tx)?;
    let now = Utc::now().to_rfc3339();

    let note = format!("Storno {}: {}", original.0, input.reason);

    tx.execute(
      "INSERT INTO transactions (public_id, date, year, month, type, payment_method, category_id, description, amount_chf, mwst_rate, receipt_path, note, ref_public_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?12, ?13, ?14)",
      params![
        public_id,
        input.date,
        year,
        month,
        original.1,
        original.2,
        original.3,
        original.4,
        storno_amount,
        original.6,
        note,
        original.0,
        now,
        now
      ],
    )?;

    append_audit(
      &tx,
      actor,
      "STORNO_TX",
      "TRANSACTION",
      Some(public_id.clone()),
      Some(original.0.clone()),
      payload_json,
      None,
    )?;

    tx.commit()?;
    fetch_transaction_by_public_id(conn, &public_id)
  })
}

#[tauri::command]
pub fn delete_transaction(state: State<AppState>, public_id: String, actor: Option<String>) -> Result<i64, AppError> {
  let public_id = public_id.trim().to_string();
  if public_id.is_empty() {
    return Err(AppError::new("INVALID_ID", "ID fehlt"));
  }

  db::with_conn(&state.db, |conn| {
    let (year, month) = conn.query_row(
      "SELECT year, month FROM transactions WHERE public_id = ?1",
      params![public_id],
      |row| Ok((row.get::<_, i32>(0)?, row.get::<_, i32>(1)?)),
    ).map_err(|_| AppError::new("NOT_FOUND", "Eintrag nicht gefunden"))?;

    if closing::is_month_closed(conn, year, month)? {
      return Err(AppError::new("MONTH_CLOSED", "Monat abgeschlossen"));
    }

    let tx = conn.transaction()?;
    let mut deleted = 0_i64;
    deleted += tx.execute("DELETE FROM transactions WHERE ref_public_id = ?1", params![public_id])? as i64;
    deleted += tx.execute("DELETE FROM transactions WHERE public_id = ?1", params![public_id])? as i64;

    let payload_json = serde_json::to_string(&serde_json::json!({
      "public_id": public_id,
      "deleted": deleted,
    }))
    .unwrap_or_else(|_| "{}".to_string());
    append_audit(
      &tx,
      actor,
      "DELETE_TX",
      "TRANSACTION",
      None,
      None,
      payload_json,
      Some("Eintrag geloescht".to_string()),
    )?;

    tx.commit()?;
    Ok(deleted)
  })
}

#[tauri::command]
pub fn list_transactions(state: State<AppState>, filter: TransactionFilter) -> Result<Paginated<TransactionListItem>, AppError> {
  let search = filter.search.clone().unwrap_or_default();
  let search_trimmed = search.trim();
  let has_search = !search_trimmed.is_empty();
  let page = if filter.page < 1 { 1 } else { filter.page };
  let page_size = if filter.page_size < 1 { 50 } else { filter.page_size };
  let offset = (page - 1) * page_size;

  db::with_conn(&state.db, |conn| {
    let total: i64 = if has_search {
      let like = format!("%{}%", search_trimmed);
      conn.query_row(
        "SELECT COUNT(*) FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.year = ?1 AND t.month = ?2 AND t.type = ?3
           AND (t.public_id LIKE ?4 OR t.description LIKE ?4 OR t.note LIKE ?4 OR c.name LIKE ?4
                OR t.date LIKE ?4 OR t.payment_method LIKE ?4 OR t.ref_public_id LIKE ?4
                OR CAST(t.amount_chf AS TEXT) LIKE ?4)",
        params![filter.year, filter.month, filter.tx_type, like],
        |row| row.get(0),
      )?
    } else {
      conn.query_row(
        "SELECT COUNT(*) FROM transactions WHERE year = ?1 AND month = ?2 AND type = ?3",
        params![filter.year, filter.month, filter.tx_type],
        |row| row.get(0),
      )?
    };

    let mut items = Vec::new();
    if has_search {
      let like = format!("%{}%", search_trimmed);
      let mut stmt = conn.prepare(
        "SELECT t.id, t.public_id, t.date, t.year, t.month, t.type, t.payment_method, t.category_id,
                c.name, t.description, t.amount_chf, t.mwst_rate, t.receipt_path, t.note, t.ref_public_id,
                t.created_at, t.updated_at,
                EXISTS (SELECT 1 FROM transactions x WHERE x.ref_public_id = t.public_id) as is_stornoed
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.year = ?1 AND t.month = ?2 AND t.type = ?3
           AND (t.public_id LIKE ?4 OR t.description LIKE ?4 OR t.note LIKE ?4 OR c.name LIKE ?4
                OR t.date LIKE ?4 OR t.payment_method LIKE ?4 OR t.ref_public_id LIKE ?4
                OR CAST(t.amount_chf AS TEXT) LIKE ?4)
         ORDER BY t.date DESC, t.public_id DESC
         LIMIT ?5 OFFSET ?6",
      )?;
      let rows = stmt.query_map(
        params![filter.year, filter.month, filter.tx_type, like, page_size, offset],
        |row| map_transaction_row(row),
      )?;
      for row in rows {
        items.push(row?);
      }
    } else {
      let mut stmt = conn.prepare(
        "SELECT t.id, t.public_id, t.date, t.year, t.month, t.type, t.payment_method, t.category_id,
                c.name, t.description, t.amount_chf, t.mwst_rate, t.receipt_path, t.note, t.ref_public_id,
                t.created_at, t.updated_at,
                EXISTS (SELECT 1 FROM transactions x WHERE x.ref_public_id = t.public_id) as is_stornoed
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.year = ?1 AND t.month = ?2 AND t.type = ?3
         ORDER BY t.date DESC, t.public_id DESC
         LIMIT ?4 OFFSET ?5",
      )?;
      let rows = stmt.query_map(
        params![filter.year, filter.month, filter.tx_type, page_size, offset],
        |row| map_transaction_row(row),
      )?;
      for row in rows {
        items.push(row?);
      }
    }

    Ok(Paginated { total, items })
  })
}

#[tauri::command]
pub fn search_transactions(state: State<AppState>, query: String, limit: i64) -> Result<Vec<TransactionListItem>, AppError> {
  let search_trimmed = query.trim();
  if search_trimmed.is_empty() {
    return Ok(Vec::new());
  }
  let limit = if limit < 1 { 20 } else { limit.min(100) };
  let like = format!("%{}%", search_trimmed);

  db::with_conn(&state.db, |conn| {
    let mut stmt = conn.prepare(
      "SELECT t.id, t.public_id, t.date, t.year, t.month, t.type, t.payment_method, t.category_id,
              c.name, t.description, t.amount_chf, t.mwst_rate, t.receipt_path, t.note, t.ref_public_id,
              t.created_at, t.updated_at,
              EXISTS (SELECT 1 FROM transactions x WHERE x.ref_public_id = t.public_id) as is_stornoed
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE (t.public_id LIKE ?1 OR t.description LIKE ?1 OR t.note LIKE ?1 OR c.name LIKE ?1
          OR t.date LIKE ?1 OR t.payment_method LIKE ?1 OR t.ref_public_id LIKE ?1
          OR CAST(t.amount_chf AS TEXT) LIKE ?1 OR t.type LIKE ?1)
       ORDER BY t.date DESC, t.public_id DESC
       LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![like, limit], |row| map_transaction_row(row))?;
    let mut items = Vec::new();
    for row in rows {
      items.push(row?);
    }
    Ok(items)
  })
}

#[tauri::command]
pub fn search_transactions_paginated(
  state: State<AppState>,
  query: String,
  page: i64,
  page_size: i64,
) -> Result<Paginated<TransactionListItem>, AppError> {
  let search_trimmed = query.trim();
  if search_trimmed.is_empty() {
    return Ok(Paginated { total: 0, items: Vec::new() });
  }
  let page = if page < 1 { 1 } else { page };
  let page_size = if page_size < 1 { 50 } else { page_size.min(200) };
  let offset = (page - 1) * page_size;
  let like = format!("%{}%", search_trimmed);

  db::with_conn(&state.db, |conn| {
    let total: i64 = conn.query_row(
      "SELECT COUNT(*)
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE (t.public_id LIKE ?1 OR t.description LIKE ?1 OR t.note LIKE ?1 OR c.name LIKE ?1
          OR t.date LIKE ?1 OR t.payment_method LIKE ?1 OR t.ref_public_id LIKE ?1
          OR CAST(t.amount_chf AS TEXT) LIKE ?1 OR t.type LIKE ?1)",
      params![like],
      |row| row.get(0),
    )?;

    let mut stmt = conn.prepare(
      "SELECT t.id, t.public_id, t.date, t.year, t.month, t.type, t.payment_method, t.category_id,
              c.name, t.description, t.amount_chf, t.mwst_rate, t.receipt_path, t.note, t.ref_public_id,
              t.created_at, t.updated_at,
              EXISTS (SELECT 1 FROM transactions x WHERE x.ref_public_id = t.public_id) as is_stornoed
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE (t.public_id LIKE ?1 OR t.description LIKE ?1 OR t.note LIKE ?1 OR c.name LIKE ?1
          OR t.date LIKE ?1 OR t.payment_method LIKE ?1 OR t.ref_public_id LIKE ?1
          OR CAST(t.amount_chf AS TEXT) LIKE ?1 OR t.type LIKE ?1)
       ORDER BY t.date DESC, t.public_id DESC
       LIMIT ?2 OFFSET ?3",
    )?;
    let rows = stmt.query_map(params![like, page_size, offset], |row| map_transaction_row(row))?;
    let mut items = Vec::new();
    for row in rows {
      items.push(row?);
    }
    Ok(Paginated { total, items })
  })
}

#[tauri::command]
pub fn seed_mock_data(state: State<AppState>, count: i64, actor: Option<String>) -> Result<i64, AppError> {
  let count = count.clamp(1, 200_000) as usize;
  let seed = Utc::now().timestamp_millis() as u64;
  let mut rng = MockRng::new(seed);

  db::with_conn(&state.db, |conn| {
    let tx = conn.transaction()?;
    let settings = settings::get_settings(&tx)?;
    let year = settings.current_year;

    let categories = load_or_seed_categories(&tx)?;
    if categories.is_empty() {
      return Err(AppError::new("CATEGORIES", "Keine Kategorien vorhanden"));
    }

    let base_folder = resolve_receipt_base(&settings, &state);
    std::fs::create_dir_all(&base_folder)?;
    let demo_receipt = base_folder.join("demo_receipt.png");
    if !demo_receipt.exists() {
      std::fs::write(&demo_receipt, DEMO_PNG_BYTES)?;
    }
    let demo_receipt_path = demo_receipt.to_string_lossy().to_string();

    let max_id: Option<i64> = tx.query_row(
      "SELECT MAX(CAST(public_id AS INTEGER)) FROM transactions",
      [],
      |row| row.get(0),
    )?;
    let mut next_id = max_id.unwrap_or(0) + 1;

    let mwst_options = [0.0, 2.6, 3.8, 7.7, 8.1];
      let income_notes = [
        "Mittagsverkauf",
        "Abendverkauf",
        "Catering",
        "Event",
        "Wochenmarkt",
      ];
    let expense_descriptions = [
      "Zutaten Einkauf",
      "Standplatz",
      "Treibstoff",
      "Verpackung",
      "Reparatur",
      "Werbung",
      "Reinigung",
    ];

    let mut income_stmt = tx.prepare(
      "INSERT INTO transactions (public_id, date, year, month, type, payment_method, category_id, description, amount_chf, mwst_rate, receipt_path, note, ref_public_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'INCOME', ?5, NULL, NULL, ?6, ?7, NULL, ?8, NULL, ?9, ?10)",
    )?;
    let mut expense_stmt = tx.prepare(
      "INSERT INTO transactions (public_id, date, year, month, type, payment_method, category_id, description, amount_chf, mwst_rate, receipt_path, note, ref_public_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'EXPENSE', NULL, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?12)",
    )?;

    for _ in 0..count {
      let month = (rng.next_u32() % 12 + 1) as u32;
      let day = (rng.next_u32() % days_in_month(year, month) + 1) as u32;
      let date = chrono::NaiveDate::from_ymd_opt(year, month, day)
        .unwrap_or_else(|| chrono::NaiveDate::from_ymd_opt(year, month, 1).unwrap());
      let date_str = date.format("%Y-%m-%d").to_string();

      let public_id = format!("{:06}", next_id);
      next_id += 1;
      let now = Utc::now().to_rfc3339();

      let is_income = (rng.next_u32() % 100) < 65;
      if is_income {
        let payment_method = if (rng.next_u32() % 2) == 0 { "BAR" } else { "TWINT" };
        let amount = random_amount(&mut rng, 20.0, 700.0);
        let mwst_rate = mwst_options[(rng.next_u32() as usize) % mwst_options.len()];
        let note = income_notes[(rng.next_u32() as usize) % income_notes.len()];

        income_stmt.execute(params![
          public_id,
          date_str,
          year,
          month as i32,
          payment_method,
          amount,
          mwst_rate,
          format!("Demo: {note}"),
          now,
          now
        ])?;
      } else {
        let idx = (rng.next_u32() as usize) % categories.len();
        let (category_id, default_mwst, _category_name) = &categories[idx];
        let description = expense_descriptions[(rng.next_u32() as usize) % expense_descriptions.len()];
        let amount = random_amount(&mut rng, 10.0, 950.0);
        let receipt_path = if (rng.next_u32() % 100) < 15 {
          Some(demo_receipt_path.clone())
        } else {
          None
        };

        expense_stmt.execute(params![
          public_id,
          date_str,
          year,
          month as i32,
          category_id,
          description,
          amount,
          *default_mwst,
          receipt_path,
          Some(format!("Demo: {description}")),
          now,
          now
        ])?;
      }
    }

    drop(income_stmt);
    drop(expense_stmt);

    let payload_json = serde_json::to_string(&serde_json::json!({
      "count": count,
      "year": year,
    }))
    .unwrap_or_else(|_| "{}".to_string());

    append_audit(
      &tx,
      actor,
      "IMPORT",
      "TRANSACTION",
      Some(format!("mock:{}", count)),
      None,
      payload_json,
      Some("Mock-Daten erzeugt".to_string()),
    )?;

    tx.commit()?;
    Ok(count as i64)
  })
}

#[tauri::command]
pub fn clear_demo_data(state: State<AppState>, actor: Option<String>) -> Result<i64, AppError> {
  let income_notes = [
    "Mittagsverkauf",
    "Abendverkauf",
    "Catering",
    "Event",
    "Wochenmarkt",
  ];

  db::with_conn(&state.db, |conn| {
    let tx = conn.transaction()?;
    let mut deleted = 0_i64;
    deleted += tx.execute(
      "DELETE FROM transactions
       WHERE note LIKE 'Demo%' OR note LIKE '[DEMO]%' OR note LIKE 'DEMO%'
          OR receipt_path LIKE '%demo_receipt.png'",
      [],
    )? as i64;

    deleted += tx.execute(
      "DELETE FROM transactions
       WHERE type = 'INCOME' AND note IN (?1, ?2, ?3, ?4, ?5)",
      params![
        income_notes[0],
        income_notes[1],
        income_notes[2],
        income_notes[3],
        income_notes[4],
      ],
    )? as i64;

    let settings = settings::get_settings(&tx)?;
    let base_folder = resolve_receipt_base(&settings, &state);
    let demo_receipt = base_folder.join("demo_receipt.png");
    if demo_receipt.exists() {
      let remaining: i64 = tx.query_row(
        "SELECT COUNT(*) FROM transactions WHERE receipt_path LIKE '%demo_receipt.png'",
        [],
        |row| row.get(0),
      )?;
      if remaining == 0 {
        let _ = fs::remove_file(&demo_receipt);
      }
    }

    let payload_json = serde_json::to_string(&serde_json::json!({
      "deleted": deleted,
    }))
    .unwrap_or_else(|_| "{}".to_string());
    append_audit(
      &tx,
      actor,
      "DELETE_DEMO",
      "TRANSACTION",
      None,
      None,
      payload_json,
      Some("Mock-Daten geloescht".to_string()),
    )?;

    tx.commit()?;
    Ok(deleted)
  })
}

#[tauri::command]
pub fn get_month_kpis(state: State<AppState>, year: i32, month: i32) -> Result<MonthKpis, AppError> {
  db::with_conn(&state.db, |conn| {
    let base = reports::get_month_base_kpis(conn, year, month)?;
    let settings = settings::get_settings(conn)?;
    let result = base.income_total - base.expense_total;
    let margin = mwst::safe_margin(result, base.income_total);
    let mwst_due = if settings.mwst_mode == "SALDO" {
      mwst::saldo_due(base.income_total, settings.mwst_saldo_rate)
    } else {
      mwst::effective_due(base.mwst_income, base.mwst_expense)
    };

    Ok(MonthKpis {
      income_total: base.income_total,
      income_bar: base.income_bar,
      income_twint: base.income_twint,
      expense_total: base.expense_total,
      result,
      margin,
      mwst_income: base.mwst_income,
      mwst_expense: base.mwst_expense,
      mwst_due,
      missing_receipts_count: base.missing_receipts_count,
      missing_receipts_sum: base.missing_receipts_sum,
    })
  })
}

#[tauri::command]
pub fn get_year_kpis(state: State<AppState>, year: i32) -> Result<YearKpis, AppError> {
  db::with_conn(&state.db, |conn| {
    let base = reports::get_year_base_kpis(conn, year)?;
    let settings = settings::get_settings(conn)?;
    let result = base.income_total - base.expense_total;
    let margin = mwst::safe_margin(result, base.income_total);
    let mwst_due = if settings.mwst_mode == "SALDO" {
      mwst::saldo_due(base.income_total, settings.mwst_saldo_rate)
    } else {
      mwst::effective_due(base.mwst_income, base.mwst_expense)
    };

    Ok(YearKpis {
      income_total: base.income_total,
      income_bar: base.income_bar,
      income_twint: base.income_twint,
      expense_total: base.expense_total,
      result,
      margin,
      mwst_income: base.mwst_income,
      mwst_expense: base.mwst_expense,
      mwst_due,
      missing_receipts_count: base.missing_receipts_count,
      missing_receipts_sum: base.missing_receipts_sum,
    })
  })
}

#[tauri::command]
pub fn get_month_charts(state: State<AppState>, year: i32, month: i32) -> Result<MonthCharts, AppError> {
  db::with_conn(&state.db, |conn| {
    Ok(MonthCharts {
      daily: reports::get_daily_series(conn, year, month)?,
      payments: reports::get_payment_split(conn, year, Some(month))?,
      categories: reports::get_top_categories(conn, year, Some(month), 8)?,
    })
  })
}

#[tauri::command]
pub fn get_year_charts(state: State<AppState>, year: i32) -> Result<YearCharts, AppError> {
  db::with_conn(&state.db, |conn| {
    Ok(YearCharts {
      monthly: reports::get_month_series(conn, year)?,
      payments: reports::get_payment_split(conn, year, None)?,
      categories: reports::get_top_categories(conn, year, None, 8)?,
    })
  })
}

#[tauri::command]
pub fn get_month_status(state: State<AppState>, year: i32, month: i32) -> Result<MonthStatus, AppError> {
  db::with_conn(&state.db, |conn| closing::get_month_status(conn, year, month))
}

#[tauri::command]
pub fn close_month(state: State<AppState>, year: i32, month: i32, actor: Option<String>) -> Result<(), AppError> {
  db::with_conn(&state.db, |conn| {
    let now = Utc::now().to_rfc3339();
    conn.execute(
      "INSERT OR IGNORE INTO month_closing (year, month, is_closed, closed_at, closed_by) VALUES (?1, ?2, 0, NULL, NULL)",
      params![year, month],
    )?;
    conn.execute(
      "UPDATE month_closing SET is_closed = 1, closed_at = ?1, closed_by = ?2 WHERE year = ?3 AND month = ?4",
      params![now, actor.clone(), year, month],
    )?;
    append_audit(
      conn,
      actor,
      "CLOSE_MONTH",
      "MONTH",
      Some(format!("{year}-{month:02}")),
      None,
      "{}".to_string(),
      None,
    )?;
    Ok(())
  })
}

#[tauri::command]
pub fn open_month(state: State<AppState>, year: i32, month: i32, actor: Option<String>) -> Result<(), AppError> {
  db::with_conn(&state.db, |conn| {
    conn.execute(
      "INSERT OR IGNORE INTO month_closing (year, month, is_closed, closed_at, closed_by) VALUES (?1, ?2, 0, NULL, NULL)",
      params![year, month],
    )?;
    conn.execute(
      "UPDATE month_closing SET is_closed = 0, closed_at = NULL, closed_by = NULL WHERE year = ?1 AND month = ?2",
      params![year, month],
    )?;
    append_audit(
      conn,
      actor,
      "OPEN_MONTH",
      "MONTH",
      Some(format!("{year}-{month:02}")),
      None,
      "{}".to_string(),
      None,
    )?;
    Ok(())
  })
}

#[tauri::command]
pub fn list_audit_log(state: State<AppState>, page: i64, page_size: i64) -> Result<Paginated<AuditLogEntry>, AppError> {
  let page = if page < 1 { 1 } else { page };
  let page_size = if page_size < 1 { 100 } else { page_size };
  let offset = (page - 1) * page_size;

  db::with_conn(&state.db, |conn| {
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM audit_log", [], |row| row.get(0))?;
    let mut stmt = conn.prepare(
      "SELECT id, ts, actor, action, entity_type, entity_id, ref_id, payload_json, details
       FROM audit_log
       ORDER BY ts DESC
       LIMIT ?1 OFFSET ?2",
    )?;
    let rows = stmt.query_map(params![page_size, offset], |row| {
      Ok(AuditLogEntry {
        id: row.get(0)?,
        ts: row.get(1)?,
        actor: row.get(2)?,
        action: row.get(3)?,
        entity_type: row.get(4)?,
        entity_id: row.get(5)?,
        ref_id: row.get(6)?,
        payload_json: row.get(7)?,
        details: row.get(8)?,
      })
    })?;

    let mut items = Vec::new();
    for row in rows {
      items.push(row?);
    }

    Ok(Paginated { total, items })
  })
}

#[tauri::command]
pub fn export_excel(state: State<AppState>, request: ExportRequest) -> Result<String, AppError> {
  let app_dir = state.app_dir.clone();
  db::with_conn(&state.db, |conn| {
    let export_dir = app_dir.join("Exports");
    fs::create_dir_all(&export_dir)?;
    let filename = if let Some(month) = request.month {
      format!("export_{}_{}.xlsx", request.year, format!("{:02}", month))
    } else if let (Some(month_from), Some(month_to)) = (request.month_from, request.month_to) {
      format!(
        "export_{}_{}-{}.xlsx",
        request.year,
        format!("{:02}", month_from),
        format!("{:02}", month_to)
      )
    } else {
      format!("export_{}.xlsx", request.year)
    };

    let output_path = PathBuf::from(
      request
      .output_path
      .clone()
      .unwrap_or_else(|| export_dir.join(&filename).to_string_lossy().to_string()),
    );

    let base_name = output_path
      .file_stem()
      .and_then(|value| value.to_str())
      .unwrap_or("export");
    let export_root = output_path
      .parent()
      .unwrap_or(export_dir.as_path())
      .join(base_name);
    fs::create_dir_all(&export_root)?;
    let receipts_dir = export_root.join("Belege");
    fs::create_dir_all(&receipts_dir)?;
    let excel_path = export_root.join(
      output_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&filename),
    );

    if let Some(month) = request.month {
      ensure_month(month)?;
      excel::export_month(conn, request.year, month, excel_path.as_path(), Some(&receipts_dir))?;
    } else if let (Some(month_from), Some(month_to)) = (request.month_from, request.month_to) {
      ensure_month_range(month_from, month_to)?;
      excel::export_range(conn, request.year, month_from, month_to, excel_path.as_path(), Some(&receipts_dir))?;
    } else {
      excel::export_year(conn, request.year, excel_path.as_path(), Some(&receipts_dir))?;
    }

    let payload_json = serde_json::to_string(&request).unwrap_or_else(|_| "{}".to_string());
    append_audit(
      conn,
      request.actor,
      "EXPORT",
      "EXPORT",
      Some(excel_path.to_string_lossy().to_string()),
      None,
      payload_json,
      None,
    )?;

    Ok(excel_path.to_string_lossy().to_string())
  })
}

#[tauri::command]
pub fn export_csv(
  state: State<AppState>,
  year: i32,
  output_path: Option<String>,
  actor: Option<String>,
) -> Result<String, AppError> {
  let app_dir = state.app_dir.clone();
  db::with_conn(&state.db, |conn| {
    let export_dir = app_dir.join("Exports");
    fs::create_dir_all(&export_dir)?;
    let default_path = export_dir.join(format!("export_{}.csv", year));
    let output_path = output_path
      .clone()
      .unwrap_or_else(|| default_path.to_string_lossy().to_string());

    if let Some(parent) = PathBuf::from(&output_path).parent() {
      fs::create_dir_all(parent)?;
    }

    csv::export_year_csv(conn, year, PathBuf::from(&output_path).as_path())?;

    let payload_json = serde_json::to_string(&serde_json::json!({
      "year": year,
      "output_path": output_path,
    }))
    .unwrap_or_else(|_| "{}".to_string());

    append_audit(
      conn,
      actor,
      "EXPORT",
      "EXPORT",
      Some(output_path.clone()),
      None,
      payload_json,
      None,
    )?;

    Ok(output_path)
  })
}

#[tauri::command]
pub fn create_backup(state: State<AppState>, request: BackupRequest) -> Result<String, AppError> {
  let app_dir = state.app_dir.clone();
  db::with_conn(&state.db, |conn| {
    db::checkpoint(conn)?;
    let settings = settings::get_settings(conn)?;
    let receipt_base = resolve_receipt_base(&settings, &state);
    let path = backup::create_backup(
      &app_dir,
      &state.db.db_path,
      &receipt_base,
      request.include_receipts,
      request.output_path.clone(),
    )?;
    let payload_json = serde_json::to_string(&request).unwrap_or_else(|_| "{}".to_string());
    append_audit(
      conn,
      request.actor,
      "BACKUP",
      "EXPORT",
      Some(path.clone()),
      None,
      payload_json,
      None,
    )?;
    Ok(path)
  })
}

#[tauri::command]
pub fn restore_backup(state: State<AppState>, request: RestoreRequest) -> Result<(), AppError> {
  let receipt_base = db::with_conn(&state.db, |conn| {
    let settings = settings::get_settings(conn)?;
    Ok(resolve_receipt_base(&settings, &state))
  })?;

  backup::restore_backup(&request.archive_path, &state.db.db_path, &receipt_base)?;
  db::reload_connection(&state.db)?;

  db::with_conn(&state.db, |conn| {
    append_audit(
      conn,
      request.actor.clone(),
      "RESTORE",
      "EXPORT",
      Some(request.archive_path.clone()),
      None,
      serde_json::to_string(&request).unwrap_or_else(|_| "{}".to_string()),
      None,
    )?;
    Ok(())
  })?;

  Ok(())
}

#[tauri::command]
pub fn open_receipt(state: State<AppState>, path: String, actor: Option<String>) -> Result<(), AppError> {
  receipts::open_receipt(&path)?;
  let payload = serde_json::to_string(&serde_json::json!({ "path": path.clone() }))
    .unwrap_or_else(|_| "{}".to_string());
  db::with_conn(&state.db, |conn| {
    append_audit(
      conn,
      actor,
      "OPEN_RECEIPT",
      "TRANSACTION",
      Some(path.clone()),
      None,
      payload,
      None,
    )?;
    Ok(())
  })?;
  Ok(())
}

#[derive(Serialize)]
pub struct ReadFileResponse {
  pub data_base64: String,
  pub content_type: String,
}

#[tauri::command]
pub fn read_receipt_file(path: String) -> Result<ReadFileResponse, AppError> {
  let file_path = PathBuf::from(&path);
  if !file_path.exists() {
    return Err(AppError::new("RECEIPT_NOT_FOUND", "Belegdatei nicht gefunden"));
  }
  let ext = file_path
    .extension()
    .and_then(|ext| ext.to_str())
    .unwrap_or("")
    .to_lowercase();
  let content_type = match ext.as_str() {
    "pdf" => "application/pdf",
    "png" => "image/png",
    "jpg" | "jpeg" => "image/jpeg",
    _ => return Err(AppError::new("RECEIPT_TYPE", "Dateiformat nicht unterstuetzt")),
  };
  let metadata = fs::metadata(&file_path)?;
  if metadata.len() > OCR_FILE_MAX_BYTES {
    return Err(AppError::new("RECEIPT_SIZE", "Datei ist zu gross fuer OCR"));
  }
  let bytes = fs::read(&file_path)?;
  let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
  Ok(ReadFileResponse {
    data_base64: encoded,
    content_type: content_type.to_string(),
  })
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, AppError> {
  let file_path = PathBuf::from(&path);
  if !file_path.exists() {
    return Err(AppError::new("FILE_NOT_FOUND", "Datei nicht gefunden"));
  }
  let ext = file_path
    .extension()
    .and_then(|ext| ext.to_str())
    .unwrap_or("")
    .to_lowercase();
  if ext != "csv" && ext != "txt" {
    return Err(AppError::new("FILE_TYPE", "Dateiformat nicht unterstuetzt"));
  }
  let metadata = fs::metadata(&file_path)?;
  if metadata.len() > IMPORT_FILE_MAX_BYTES {
    return Err(AppError::new("FILE_SIZE", "Datei ist zu gross fuer den Import"));
  }
  let content = fs::read_to_string(&file_path)?;
  Ok(content)
}

#[tauri::command]
pub fn get_sync_status(state: State<AppState>) -> Result<SyncStatus, AppError> {
  build_sync_status(&state)
}

#[tauri::command]
pub fn resolve_sync_conflict(state: State<AppState>, action: String) -> Result<SyncStatus, AppError> {
  sync::resolve_sync_conflict(&state, &action)?;
  build_sync_status(&state)
}

#[tauri::command]
pub fn import_twint(state: State<AppState>, request: TwintImportRequest) -> Result<TwintImportSummary, AppError> {
  if request.rows.is_empty() {
    return Err(AppError::new("IMPORT_EMPTY", "Keine Daten fuer den Import"));
  }
  validation::ensure_mwst_rate(request.income_mwst_rate)?;
  validation::ensure_mwst_rate(request.fee_mwst_rate)?;
  let skip_duplicates = request.skip_duplicates.unwrap_or(true);

  db::with_conn(&state.db, |conn| {
    let tx = conn.transaction()?;
    let fee_category_id = ensure_fee_category(&tx, request.fee_mwst_rate)?;

    let max_id: Option<i64> = tx.query_row(
      "SELECT MAX(CAST(public_id AS INTEGER)) FROM transactions",
      [],
      |row| row.get(0),
    )?;
    let mut next_id = max_id.unwrap_or(0) + 1;
    let now = Utc::now().to_rfc3339();

    let mut income_stmt = tx.prepare(
      "INSERT INTO transactions (public_id, date, year, month, type, payment_method, category_id, description, amount_chf, mwst_rate, receipt_path, note, ref_public_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'INCOME', 'TWINT', NULL, NULL, ?5, ?6, NULL, ?7, NULL, ?8, ?9)",
    )?;
    let mut expense_stmt = tx.prepare(
      "INSERT INTO transactions (public_id, date, year, month, type, payment_method, category_id, description, amount_chf, mwst_rate, receipt_path, note, ref_public_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'EXPENSE', NULL, ?5, ?6, ?7, ?8, NULL, ?9, NULL, ?10, ?11)",
    )?;

    let mut closed_months: HashSet<(i32, i32)> = HashSet::new();
    let mut income_created = 0;
    let mut fee_created = 0;
    let mut skipped_duplicates = 0;

    for row in request.rows {
      let date = validation::parse_date(&row.date)?;
      let year = date.year();
      let month = date.month() as i32;

      if !closed_months.contains(&(year, month)) && closing::is_month_closed(&tx, year, month)? {
        return Err(AppError::new("MONTH_CLOSED", "Monat abgeschlossen"));
      }
      closed_months.insert((year, month));

      let amount = row.amount_chf.abs();
      if amount <= 0.0 {
        continue;
      }
      let note = build_twint_note(row.reference.as_deref(), row.description.as_deref());

      if skip_duplicates {
        if check_duplicate_income(&tx, date, amount, "TWINT", note.as_deref())?.is_some() {
          skipped_duplicates += 1;
          continue;
        }
      }

      let public_id = format!("{:06}", next_id);
      next_id += 1;

      income_stmt.execute(params![
        public_id,
        row.date,
        year,
        month,
        amount,
        request.income_mwst_rate,
        note.clone(),
        now,
        now
      ])?;
      income_created += 1;

      if let Some(fee) = row.fee_chf {
        let fee_amount = fee.abs();
        if fee_amount > 0.0 {
          let fee_desc = build_twint_fee_description(row.reference.as_deref());
          if skip_duplicates {
            if check_duplicate_expense(&tx, date, fee_amount, fee_category_id, Some(&fee_desc))?.is_some() {
              skipped_duplicates += 1;
              continue;
            }
          }
          let fee_id = format!("{:06}", next_id);
          next_id += 1;
          expense_stmt.execute(params![
            fee_id,
            row.date,
            year,
            month,
            fee_category_id,
            fee_desc,
            fee_amount,
            request.fee_mwst_rate,
            note.clone(),
            now,
            now
          ])?;
          fee_created += 1;
        }
      }
    }

    drop(income_stmt);
    drop(expense_stmt);

    let payload_json = serde_json::to_string(&serde_json::json!({
      "income_created": income_created,
      "fee_created": fee_created,
      "skipped_duplicates": skipped_duplicates,
    }))
    .unwrap_or_else(|_| "{}".to_string());

    append_audit(
      &tx,
      request.actor,
      "IMPORT_TWINT",
      "TRANSACTION",
      None,
      None,
      payload_json,
      Some("TWINT Import".to_string()),
    )?;

    tx.commit()?;

    Ok(TwintImportSummary {
      income_created,
      fee_created,
      skipped_duplicates,
    })
  })
}

fn map_transaction_row(row: &rusqlite::Row) -> Result<TransactionListItem, rusqlite::Error> {
  Ok(TransactionListItem {
    id: row.get(0)?,
    public_id: row.get(1)?,
    date: row.get(2)?,
    year: row.get(3)?,
    month: row.get(4)?,
    tx_type: row.get(5)?,
    payment_method: row.get(6)?,
    category_id: row.get(7)?,
    category_name: row.get(8)?,
    description: row.get(9)?,
    amount_chf: row.get(10)?,
    mwst_rate: row.get(11)?,
    receipt_path: row.get(12)?,
    note: row.get(13)?,
    ref_public_id: row.get(14)?,
    created_at: row.get(15)?,
    updated_at: row.get(16)?,
    is_stornoed: row.get::<_, i64>(17)? == 1,
  })
}

fn next_public_id(conn: &Connection) -> Result<String, AppError> {
  let max_id: Option<i64> = conn.query_row(
    "SELECT MAX(CAST(public_id AS INTEGER)) FROM transactions",
    [],
    |row| row.get(0),
  )?;
  let next = max_id.unwrap_or(0) + 1;
  Ok(format!("{:06}", next))
}

fn fetch_transaction_by_public_id(conn: &Connection, public_id: &str) -> Result<TransactionListItem, AppError> {
  let mut stmt = conn.prepare(
    "SELECT t.id, t.public_id, t.date, t.year, t.month, t.type, t.payment_method, t.category_id,
            c.name, t.description, t.amount_chf, t.mwst_rate, t.receipt_path, t.note, t.ref_public_id,
            t.created_at, t.updated_at,
            EXISTS (SELECT 1 FROM transactions x WHERE x.ref_public_id = t.public_id) as is_stornoed
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.public_id = ?1",
  )?;
  let item = stmt.query_row(params![public_id], |row| map_transaction_row(row))?;
  Ok(item)
}

fn check_duplicate_income(
  conn: &Connection,
  date: NaiveDate,
  amount: f64,
  payment_method: &str,
  note: Option<&str>,
) -> Result<Option<String>, AppError> {
  let start = date - Duration::days(7);
  let end = date + Duration::days(7);
  let note_value = note.unwrap_or("");

  let mut stmt = conn.prepare(
    "SELECT public_id
     FROM transactions
     WHERE type = 'INCOME'
       AND date BETWEEN ?1 AND ?2
       AND amount_chf = ?3
       AND payment_method = ?4
       AND COALESCE(note, '') = ?5
     LIMIT 1",
  )?;
  let mut rows = stmt.query(params![start.to_string(), end.to_string(), amount, payment_method, note_value])?;
  if let Some(row) = rows.next()? {
    Ok(Some(row.get(0)?))
  } else {
    Ok(None)
  }
}

fn check_duplicate_expense(
  conn: &Connection,
  date: NaiveDate,
  amount: f64,
  category_id: i64,
  description: Option<&str>,
) -> Result<Option<String>, AppError> {
  let start = date - Duration::days(7);
  let end = date + Duration::days(7);
  let description_value = description.unwrap_or("");

  let mut stmt = conn.prepare(
    "SELECT public_id
     FROM transactions
     WHERE type = 'EXPENSE'
       AND date BETWEEN ?1 AND ?2
       AND amount_chf = ?3
       AND category_id = ?4
       AND COALESCE(description, '') = ?5
     LIMIT 1",
  )?;
  let mut rows = stmt.query(params![start.to_string(), end.to_string(), amount, category_id, description_value])?;
  if let Some(row) = rows.next()? {
    Ok(Some(row.get(0)?))
  } else {
    Ok(None)
  }
}


fn load_or_seed_categories(conn: &Connection) -> Result<Vec<(i64, f64, String)>, AppError> {
  let mut stmt = conn.prepare(
    "SELECT id, default_mwst_rate, name FROM categories WHERE is_active = 1 ORDER BY id",
  )?;
  let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
  let mut items: Vec<(i64, f64, String)> = rows.filter_map(Result::ok).collect();
  if !items.is_empty() {
    return Ok(items);
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

  let mut stmt = conn.prepare(
    "SELECT id, default_mwst_rate, name FROM categories WHERE is_active = 1 ORDER BY id",
  )?;
  let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
  items = rows.filter_map(Result::ok).collect();
  Ok(items)
}

fn days_in_month(year: i32, month: u32) -> u32 {
  let next = if month == 12 {
    chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1)
  } else {
    chrono::NaiveDate::from_ymd_opt(year, month + 1, 1)
  };
  let next_date = next.unwrap_or_else(|| chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1).unwrap());
  (next_date - chrono::Duration::days(1)).day()
}

fn random_amount(rng: &mut MockRng, min: f64, max: f64) -> f64 {
  let range = (max - min).max(1.0);
  let base = min + (rng.next_u32() as f64 % range);
  let cents = (rng.next_u32() % 100) as f64 / 100.0;
  ((base + cents) * 100.0).round() / 100.0
}

struct MockRng {
  state: u64,
}

impl MockRng {
  fn new(seed: u64) -> Self {
    Self { state: seed }
  }

  fn next_u32(&mut self) -> u32 {
    self.state = self.state.wrapping_mul(6364136223846793005).wrapping_add(1);
    (self.state >> 32) as u32
  }
}

const DEMO_PNG_BYTES: &[u8] = &[
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xDE, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
  0x54, 0x08, 0xD7, 0x63, 0xF8, 0x0F, 0x00, 0x01,
  0x01, 0x01, 0x00, 0x18, 0xDD, 0x8D, 0x33, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
  0x42, 0x60, 0x82,
];

fn resolve_receipt_base(settings: &Settings, state: &AppState) -> PathBuf {
  if settings.receipt_base_folder.trim().is_empty() {
    return state.receipt_base.clone();
  }
  let path = PathBuf::from(&settings.receipt_base_folder);
  if path.exists() {
    path
  } else {
    state.receipt_base.clone()
  }
}

fn ensure_month(month: i32) -> Result<(), AppError> {
  if !(1..=12).contains(&month) {
    Err(AppError::new("INVALID_MONTH", "Monat muss zwischen 1 und 12 sein"))
  } else {
    Ok(())
  }
}

fn ensure_month_range(month_from: i32, month_to: i32) -> Result<(), AppError> {
  ensure_month(month_from)?;
  ensure_month(month_to)?;
  if month_from > month_to {
    Err(AppError::new("INVALID_MONTH_RANGE", "Monatsbereich ungueltig"))
  } else {
    Ok(())
  }
}

fn build_sync_status(state: &AppState) -> Result<SyncStatus, AppError> {
  let last_change = db::with_conn(&state.db, |conn| sync::get_last_change(conn))?;
  let snapshot = state.sync.snapshot()?;
  Ok(SyncStatus {
    active: state.sync.is_active(),
    port: state.sync.port(),
    pair_code: snapshot.pair_code,
    local_ip: sync::local_ip_string(),
    last_change,
    paired_devices: snapshot.paired_devices,
    pending_conflict: snapshot.pending_conflict,
  })
}

fn ensure_fee_category(conn: &Connection, default_mwst: f64) -> Result<i64, AppError> {
  let mut stmt = conn.prepare("SELECT id FROM categories WHERE name = ?1 LIMIT 1")?;
  let mut rows = stmt.query(params!["TWINT Gebuehren"])?;
  if let Some(row) = rows.next()? {
    return Ok(row.get(0)?);
  }
  conn.execute(
    "INSERT INTO categories (name, description, default_mwst_rate, is_active) VALUES (?1, ?2, ?3, 1)",
    params!["TWINT Gebuehren", "Gebuehren fuer TWINT Zahlungen", default_mwst],
  )?;
  Ok(conn.last_insert_rowid())
}

fn build_twint_note(reference: Option<&str>, description: Option<&str>) -> Option<String> {
  let mut parts: Vec<String> = Vec::new();
  if let Some(value) = reference {
    if !value.trim().is_empty() {
      parts.push(format!("Ref {}", value.trim()));
    }
  }
  if let Some(value) = description {
    if !value.trim().is_empty() {
      parts.push(value.trim().to_string());
    }
  }
  if parts.is_empty() {
    Some("TWINT Import".to_string())
  } else {
    Some(format!("TWINT Import: {}", parts.join(" | ")))
  }
}

fn build_twint_fee_description(reference: Option<&str>) -> String {
  if let Some(value) = reference {
    if !value.trim().is_empty() {
      return format!("TWINT Gebuehr ({})", value.trim());
    }
  }
  "TWINT Gebuehr".to_string()
}

const OCR_FILE_MAX_BYTES: u64 = 12 * 1024 * 1024;
const IMPORT_FILE_MAX_BYTES: u64 = 5 * 1024 * 1024;
