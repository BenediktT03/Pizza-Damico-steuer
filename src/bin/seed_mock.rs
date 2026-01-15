use std::path::PathBuf;

use chrono::{Datelike, Utc};
use rusqlite::{params, Connection};

use pizza_damico_buchhaltung::db;
use pizza_damico_buchhaltung::error::AppError;
use pizza_damico_buchhaltung::files::receipts;
use pizza_damico_buchhaltung::settings;

fn main() -> Result<(), Box<dyn std::error::Error>> {
  let count = std::env::args()
    .nth(1)
    .and_then(|value| value.parse::<usize>().ok())
    .unwrap_or(30000);

  let app_dir = if let Ok(path) = std::env::var("PIZZA_DAMICO_SEED_DIR") {
    PathBuf::from(path)
  } else {
    db::resolve_app_dir()?
  };

  let (db, receipt_base) = db::init_db(&app_dir)?;

  let created = db::with_conn(&db, |conn| seed_mock_data(conn, &receipt_base, count))?;

  println!("Seeded {} Buchungen in {}", created, app_dir.display());
  Ok(())
}

fn seed_mock_data(conn: &mut Connection, receipt_base: &PathBuf, count: usize) -> Result<usize, AppError> {
  let settings = settings::get_settings(conn)?;
  let year = settings.current_year;

  let categories = load_or_seed_categories(conn)?;
  if categories.is_empty() {
    return Err(AppError::new("CATEGORIES", "Keine Kategorien vorhanden"));
  }

  let base_folder = receipts::ensure_receipt_base(receipt_base)?;
  std::fs::create_dir_all(&base_folder)?;
  let demo_receipt = base_folder.join("demo_receipt.png");
  if !demo_receipt.exists() {
    std::fs::write(&demo_receipt, DEMO_PNG_BYTES)?;
  }
  let demo_receipt_path = demo_receipt.to_string_lossy().to_string();

  let max_id: Option<i64> = conn.query_row(
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

  let mut rng = MockRng::new(Utc::now().timestamp_millis() as u64);
  let tx = conn.transaction()?;

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
      let (category_id, default_mwst) = categories[idx];
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
        default_mwst,
        receipt_path,
        Some(format!("Demo: {description}")),
        now,
        now
      ])?;
    }
  }

  drop(income_stmt);
  drop(expense_stmt);

  tx.commit()?;
  Ok(count)
}

fn load_or_seed_categories(conn: &Connection) -> Result<Vec<(i64, f64)>, AppError> {
  let mut stmt = conn.prepare(
    "SELECT id, default_mwst_rate FROM categories WHERE is_active = 1 ORDER BY id",
  )?;
  let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
  let mut items: Vec<(i64, f64)> = rows.filter_map(Result::ok).collect();
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
    "SELECT id, default_mwst_rate FROM categories WHERE is_active = 1 ORDER BY id",
  )?;
  let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
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
