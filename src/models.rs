use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Settings {
  pub current_year: i32,
  pub mwst_mode: String,
  pub mwst_saldo_rate: f64,
  pub receipt_base_folder: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncStatus {
  pub active: bool,
  pub port: u16,
  pub pair_code: String,
  pub local_ip: String,
  pub last_change: String,
  pub paired_devices: Vec<SyncDeviceInfo>,
  pub pending_conflict: Option<SyncConflictInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncDeviceInfo {
  pub device_id: String,
  pub device_name: String,
  pub last_sync_at: Option<String>,
  pub last_remote_change: Option<String>,
  pub last_known_ip: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncConflictItem {
  pub date: String,
  pub label: String,
  pub amount_chf: f64,
  pub tx_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncConflictSummary {
  pub tx_count: i64,
  pub income_total: f64,
  pub expense_total: f64,
  pub last_items: Vec<SyncConflictItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncConflictInfo {
  pub device_id: String,
  pub device_name: String,
  pub local_last_change: String,
  pub remote_last_change: String,
  pub received_at: String,
  pub local_summary: Option<SyncConflictSummary>,
  pub remote_summary: Option<SyncConflictSummary>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Category {
  pub id: i64,
  pub name: String,
  pub description: Option<String>,
  pub default_mwst_rate: f64,
  pub is_active: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CategoryInput {
  pub name: String,
  pub description: Option<String>,
  pub default_mwst_rate: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CategoryUpdateInput {
  pub id: i64,
  pub name: String,
  pub description: Option<String>,
  pub default_mwst_rate: f64,
  pub is_active: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NewIncomeInput {
  pub date: String,
  pub payment_method: String,
  pub amount_chf: f64,
  pub mwst_rate: f64,
  pub note: Option<String>,
  pub allow_duplicate: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NewExpenseInput {
  pub date: String,
  pub category_id: i64,
  pub description: Option<String>,
  pub amount_chf: f64,
  pub mwst_rate: Option<f64>,
  pub receipt_source_path: Option<String>,
  pub note: Option<String>,
  pub allow_duplicate: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StornoInput {
  pub public_id: String,
  pub date: String,
  pub amount_chf: Option<f64>,
  pub reason: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TransactionListItem {
  pub id: i64,
  pub public_id: String,
  pub date: String,
  pub year: i32,
  pub month: i32,
  #[serde(rename = "type")]
  pub tx_type: String,
  pub payment_method: Option<String>,
  pub category_id: Option<i64>,
  pub category_name: Option<String>,
  pub description: Option<String>,
  pub amount_chf: f64,
  pub mwst_rate: f64,
  pub receipt_path: Option<String>,
  pub note: Option<String>,
  pub ref_public_id: Option<String>,
  pub created_at: String,
  pub updated_at: String,
  pub is_stornoed: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TransactionFilter {
  pub year: i32,
  pub month: i32,
  pub tx_type: String,
  pub page: i64,
  pub page_size: i64,
  pub search: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Paginated<T> {
  pub total: i64,
  pub items: Vec<T>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MonthKpis {
  pub income_total: f64,
  pub income_bar: f64,
  pub income_twint: f64,
  pub expense_total: f64,
  pub result: f64,
  pub margin: f64,
  pub mwst_income: f64,
  pub mwst_expense: f64,
  pub mwst_due: f64,
  pub missing_receipts_count: i64,
  pub missing_receipts_sum: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct YearKpis {
  pub income_total: f64,
  pub income_bar: f64,
  pub income_twint: f64,
  pub expense_total: f64,
  pub result: f64,
  pub margin: f64,
  pub mwst_income: f64,
  pub mwst_expense: f64,
  pub mwst_due: f64,
  pub missing_receipts_count: i64,
  pub missing_receipts_sum: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DailySeriesPoint {
  pub date: String,
  pub income: f64,
  pub expense: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PaymentSplit {
  pub payment_method: String,
  pub amount: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CategorySplit {
  pub category: String,
  pub amount: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MonthSeriesPoint {
  pub month: i32,
  pub income: f64,
  pub expense: f64,
  pub result: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MonthStatus {
  pub year: i32,
  pub month: i32,
  pub is_closed: bool,
  pub closed_at: Option<String>,
  pub closed_by: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MonthCharts {
  pub daily: Vec<DailySeriesPoint>,
  pub payments: Vec<PaymentSplit>,
  pub categories: Vec<CategorySplit>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct YearCharts {
  pub monthly: Vec<MonthSeriesPoint>,
  pub payments: Vec<PaymentSplit>,
  pub categories: Vec<CategorySplit>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuditLogEntry {
  pub id: i64,
  pub ts: String,
  pub actor: Option<String>,
  pub action: String,
  pub entity_type: String,
  pub entity_id: Option<String>,
  pub ref_id: Option<String>,
  pub payload_json: String,
  pub details: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportRequest {
  pub year: i32,
  pub month: Option<i32>,
  pub month_from: Option<i32>,
  pub month_to: Option<i32>,
  pub output_path: Option<String>,
  pub actor: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupRequest {
  pub include_receipts: bool,
  pub output_path: Option<String>,
  pub actor: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RestoreRequest {
  pub archive_path: String,
  pub actor: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TwintImportRow {
  pub date: String,
  pub amount_chf: f64,
  pub fee_chf: Option<f64>,
  pub reference: Option<String>,
  pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TwintImportRequest {
  pub rows: Vec<TwintImportRow>,
  pub income_mwst_rate: f64,
  pub fee_mwst_rate: f64,
  pub skip_duplicates: Option<bool>,
  pub actor: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TwintImportSummary {
  pub income_created: i64,
  pub fee_created: i64,
  pub skipped_duplicates: i64,
}
