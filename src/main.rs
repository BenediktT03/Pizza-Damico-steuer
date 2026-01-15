#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audit;
mod commands;
mod db;
mod domain;
mod error;
mod export;
mod files;
mod models;
mod reports;
mod settings;
mod sync;

use std::path::PathBuf;

use db::Db;
use sync::SyncState;

pub struct AppState {
  pub db: Db,
  pub app_dir: PathBuf,
  pub receipt_base: PathBuf,
  pub sync: SyncState,
}

fn main() {
  let app_dir = db::resolve_app_dir().expect("Failed to resolve app data directory");
  let sync_dir = app_dir.clone();
  let (db, receipt_base) = db::init_db(&app_dir).expect("Failed to initialize database");

  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(AppState {
      db,
      app_dir,
      receipt_base,
      sync: SyncState::new(48080, sync_dir),
    })
    .setup(|app| {
      sync::start_sync_server(app.handle().clone());
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::get_settings,
      commands::update_settings,
      commands::list_categories,
      commands::create_category,
      commands::update_category,
      commands::deactivate_category,
      commands::create_income,
      commands::create_expense,
      commands::create_storno,
      commands::delete_transaction,
      commands::list_transactions,
      commands::search_transactions,
      commands::search_transactions_paginated,
      commands::get_month_kpis,
      commands::get_year_kpis,
      commands::get_month_charts,
      commands::get_year_charts,
      commands::get_month_status,
      commands::close_month,
      commands::open_month,
      commands::list_audit_log,
      commands::seed_mock_data,
      commands::clear_demo_data,
      commands::export_excel,
      commands::export_csv,
      commands::create_backup,
      commands::restore_backup,
      commands::open_receipt,
      commands::read_receipt_file,
      commands::read_text_file,
      commands::import_twint,
      commands::get_sync_status,
      commands::resolve_sync_conflict,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
