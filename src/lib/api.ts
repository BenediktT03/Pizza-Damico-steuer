import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

import type {
  AuditLogEntry,
  BackupRequest,
  Category,
  CategoryInput,
  CategoryUpdateInput,
  ExportRequest,
  MonthCharts,
  MonthKpis,
  MonthStatus,
  Paginated,
  RestoreRequest,
  Settings,
  SyncStatus,
  TransactionListItem,
  TwintImportRequest,
  TwintImportSummary,
  YearCharts,
  YearKpis,
} from "./types";

export interface InvokeError {
  code?: string;
  message: string;
}

export function parseInvokeError(error: unknown): InvokeError {
  if (typeof error === "string") {
    return { message: error };
  }
  if (error && typeof error === "object") {
    const err = error as Record<string, unknown>;
    if (typeof err.code === "string" && typeof err.message === "string") {
      return { code: err.code, message: err.message };
    }
    if (typeof err.message === "string") {
      try {
        const parsed = JSON.parse(err.message);
        if (parsed && typeof parsed.code === "string") {
          return parsed;
        }
      } catch {
        return { message: err.message };
      }
      return { message: err.message };
    }
  }
  return { message: "Unbekannter Fehler" };
}

export const api = {
  async getSettings(): Promise<Settings> {
    return invoke("get_settings");
  },

  async updateSettings(payload: Settings): Promise<Settings> {
    return invoke("update_settings", { settings_input: payload, settingsInput: payload });
  },

  async listCategories(): Promise<Category[]> {
    return invoke("list_categories");
  },

  async createCategory(payload: CategoryInput): Promise<Category> {
    return invoke("create_category", { input: payload });
  },

  async updateCategory(payload: CategoryUpdateInput): Promise<Category> {
    return invoke("update_category", { input: payload });
  },

  async deactivateCategory(id: number): Promise<void> {
    return invoke("deactivate_category", { id });
  },

  async createIncome(payload: {
    date: string;
    payment_method: "BAR" | "TWINT";
    amount_chf: number;
    mwst_rate: number;
    note?: string;
    allow_duplicate?: boolean;
  }): Promise<TransactionListItem> {
    return invoke("create_income", { input: payload });
  },

  async createExpense(payload: {
    date: string;
    category_id: number;
    description?: string;
    amount_chf: number;
    mwst_rate?: number;
    receipt_source_path?: string | null;
    note?: string;
    allow_duplicate?: boolean;
  }): Promise<TransactionListItem> {
    return invoke("create_expense", { input: payload });
  },

  async createStorno(payload: {
    public_id: string;
    date: string;
    amount_chf?: number;
    reason: string;
  }): Promise<TransactionListItem> {
    return invoke("create_storno", { input: payload });
  },

  async deleteTransaction(public_id: string): Promise<number> {
    return invoke("delete_transaction", { public_id, publicId: public_id });
  },


  async searchTransactions(query: string, limit = 12): Promise<TransactionListItem[]> {
    return invoke("search_transactions", { query, limit });
  },

  async searchTransactionsPaged(query: string, page: number, pageSize: number): Promise<Paginated<TransactionListItem>> {
    return invoke("search_transactions_paginated", { query, page, page_size: pageSize, pageSize });
  },

  async listTransactions(payload: {
    year: number;
    month: number;
    tx_type: string;
    page: number;
    page_size: number;
    search?: string;
  }): Promise<Paginated<TransactionListItem>> {
    return invoke("list_transactions", { filter: payload });
  },

  async getMonthKpis(year: number, month: number): Promise<MonthKpis> {
    return invoke("get_month_kpis", { year, month });
  },

  async getYearKpis(year: number): Promise<YearKpis> {
    return invoke("get_year_kpis", { year });
  },

  async getMonthCharts(year: number, month: number): Promise<MonthCharts> {
    return invoke("get_month_charts", { year, month });
  },

  async getYearCharts(year: number): Promise<YearCharts> {
    return invoke("get_year_charts", { year });
  },

  async getMonthStatus(year: number, month: number): Promise<MonthStatus> {
    return invoke("get_month_status", { year, month });
  },

  async closeMonth(year: number, month: number): Promise<void> {
    return invoke("close_month", { year, month });
  },

  async openMonth(year: number, month: number): Promise<void> {
    return invoke("open_month", { year, month });
  },

  async listAuditLog(page: number, pageSize: number): Promise<Paginated<AuditLogEntry>> {
    return invoke("list_audit_log", { page, pageSize, page_size: pageSize });
  },


  async seedMockData(count: number): Promise<number> {
    return invoke("seed_mock_data", { count });
  },

  async clearDemoData(): Promise<number> {
    return invoke("clear_demo_data");
  },

  async exportExcel(payload: ExportRequest): Promise<string> {
    return invoke("export_excel", { request: payload });
  },

  async exportCsv(year: number, output_path?: string | null): Promise<string> {
    return invoke("export_csv", { year, output_path, outputPath: output_path });
  },

  async createBackup(payload: BackupRequest): Promise<string> {
    return invoke("create_backup", { request: payload });
  },

  async restoreBackup(payload: RestoreRequest): Promise<void> {
    return invoke("restore_backup", { request: payload });
  },

  async openReceipt(path: string): Promise<void> {
    return invoke("open_receipt", { path });
  },

  async readReceiptFile(path: string): Promise<{ data_base64: string; content_type: string }> {
    return invoke("read_receipt_file", { path });
  },

  async readTextFile(path: string): Promise<string> {
    return invoke("read_text_file", { path });
  },

  async importTwint(request: TwintImportRequest): Promise<TwintImportSummary> {
    return invoke("import_twint", { request });
  },

  async getSyncStatus(): Promise<SyncStatus> {
    return invoke("get_sync_status");
  },

  async resolveSyncConflict(action: "KEEP_LOCAL" | "USE_REMOTE" | "MERGE"): Promise<SyncStatus> {
    return invoke("resolve_sync_conflict", { action });
  },

  async pickReceipt(): Promise<string | null> {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Belege", extensions: ["pdf", "png", "jpg", "jpeg"] }],
    });
    if (Array.isArray(selected)) return selected[0] ?? null;
    return selected ?? null;
  },

  async pickBackup(): Promise<string | null> {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Backup", extensions: ["zip"] }],
    });
    if (Array.isArray(selected)) return selected[0] ?? null;
    return selected ?? null;
  },

  async pickImportFile(): Promise<string | null> {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Import", extensions: ["csv", "txt"] }],
    });
    if (Array.isArray(selected)) return selected[0] ?? null;
    return selected ?? null;
  },

  async pickFolder(): Promise<string | null> {
    const selected = await open({ directory: true, multiple: false });
    if (Array.isArray(selected)) return selected[0] ?? null;
    return selected ?? null;
  },

  async pickSavePath(defaultPath: string): Promise<string | null> {
    const selected = await save({ defaultPath });
    return selected ?? null;
  },
};
