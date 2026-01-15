export interface Settings {
  current_year: number;
  mwst_mode: "EFFEKTIV" | "SALDO";
  mwst_saldo_rate: number;
  receipt_base_folder: string;
}

export interface SyncStatus {
  active: boolean;
  port: number;
  pair_code: string;
  local_ip: string;
  last_change: string;
  paired_devices: SyncDeviceInfo[];
  pending_conflict?: SyncConflictInfo | null;
}

export interface SyncDeviceInfo {
  device_id: string;
  device_name: string;
  last_sync_at?: string | null;
  last_remote_change?: string | null;
  last_known_ip?: string | null;
}

export interface SyncConflictItem {
  date: string;
  label: string;
  amount_chf: number;
  tx_type: string;
}

export interface SyncConflictSummary {
  tx_count: number;
  income_total: number;
  expense_total: number;
  last_items: SyncConflictItem[];
}

export interface SyncConflictInfo {
  device_id: string;
  device_name: string;
  local_last_change: string;
  remote_last_change: string;
  received_at: string;
  local_summary?: SyncConflictSummary | null;
  remote_summary?: SyncConflictSummary | null;
}

export interface Category {
  id: number;
  name: string;
  description?: string | null;
  default_mwst_rate: number;
  is_active: boolean;
}

export interface CategoryInput {
  name: string;
  description?: string | null;
  default_mwst_rate: number;
}

export interface CategoryUpdateInput {
  id: number;
  name: string;
  description?: string | null;
  default_mwst_rate: number;
  is_active: boolean;
}

export interface TransactionListItem {
  id: number;
  public_id: string;
  date: string;
  year: number;
  month: number;
  type: "INCOME" | "EXPENSE" | "CORRECTION";
  payment_method?: "BAR" | "TWINT" | null;
  category_id?: number | null;
  category_name?: string | null;
  description?: string | null;
  amount_chf: number;
  mwst_rate: number;
  receipt_path?: string | null;
  note?: string | null;
  ref_public_id?: string | null;
  created_at: string;
  updated_at: string;
  is_stornoed: boolean;
}

export interface MonthKpis {
  income_total: number;
  income_bar: number;
  income_twint: number;
  expense_total: number;
  result: number;
  margin: number;
  mwst_income: number;
  mwst_expense: number;
  mwst_due: number;
  missing_receipts_count: number;
  missing_receipts_sum: number;
}

export type YearKpis = MonthKpis;

export interface DailySeriesPoint {
  date: string;
  income: number;
  expense: number;
}

export interface PaymentSplit {
  payment_method: string;
  amount: number;
}

export interface CategorySplit {
  category: string;
  amount: number;
}

export interface MonthSeriesPoint {
  month: number;
  income: number;
  expense: number;
  result: number;
}

export interface MonthCharts {
  daily: DailySeriesPoint[];
  payments: PaymentSplit[];
  categories: CategorySplit[];
}

export interface YearCharts {
  monthly: MonthSeriesPoint[];
  payments: PaymentSplit[];
  categories: CategorySplit[];
}

export interface MonthStatus {
  year: number;
  month: number;
  is_closed: boolean;
  closed_at?: string | null;
  closed_by?: string | null;
}

export interface AuditLogEntry {
  id: number;
  ts: string;
  actor?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  ref_id?: string | null;
  payload_json: string;
  details?: string | null;
}

export interface Paginated<T> {
  total: number;
  items: T[];
}

export interface ExportRequest {
  year: number;
  month?: number | null;
  month_from?: number | null;
  month_to?: number | null;
  output_path?: string | null;
  actor?: string | null;
}

export interface BackupRequest {
  include_receipts: boolean;
  output_path?: string | null;
  actor?: string | null;
}

export interface RestoreRequest {
  archive_path: string;
  actor?: string | null;
}

export interface TwintImportRow {
  date: string;
  amount_chf: number;
  fee_chf?: number;
  reference?: string;
  description?: string;
}

export interface TwintImportRequest {
  rows: TwintImportRow[];
  income_mwst_rate: number;
  fee_mwst_rate: number;
  skip_duplicates?: boolean;
  actor?: string | null;
}

export interface TwintImportSummary {
  income_created: number;
  fee_created: number;
  skipped_duplicates: number;
}
