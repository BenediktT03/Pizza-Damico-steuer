use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use chrono::{DateTime, Utc};
use rand::{distributions::Alphanumeric, Rng};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};
use walkdir::WalkDir;
use tauri::Manager;

use crate::audit::log::append_audit;
use crate::db;
use crate::error::AppError;
use crate::files::backup;
use crate::models::{SyncConflictInfo, SyncConflictItem, SyncConflictSummary, SyncDeviceInfo};
use crate::AppState;

const PAIR_CODE_LEN: usize = 10;
const TOKEN_LEN: usize = 32;
const SYNC_PORT_FALLBACK: u16 = 48080;

#[derive(Debug, Clone)]
pub struct SyncSnapshot {
  pub pair_code: String,
  pub paired_devices: Vec<SyncDeviceInfo>,
  pub pending_conflict: Option<SyncConflictInfo>,
}

pub struct SyncState {
  port: u16,
  active: AtomicBool,
  store_path: PathBuf,
  store: Mutex<SyncStore>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SyncStore {
  device_id: String,
  device_name: String,
  pair_code: String,
  #[serde(default)]
  paired_devices: Vec<PairedDevice>,
  #[serde(default)]
  pending_conflict: Option<PendingConflict>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct PairedDevice {
  device_id: String,
  device_name: String,
  token: String,
  last_sync_at: Option<String>,
  last_remote_change: Option<String>,
  last_known_ip: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct PendingConflict {
  device_id: String,
  device_name: String,
  local_last_change: String,
  remote_last_change: String,
  received_at: String,
  archive_path: Option<String>,
  local_summary: Option<SyncConflictSummary>,
  remote_summary: Option<SyncConflictSummary>,
}

#[derive(Debug, Deserialize)]
struct PairRequest {
  code: String,
  device_id: String,
  device_name: String,
}

#[derive(Debug, Serialize)]
struct PairResponse {
  device_token: String,
  server_device_id: String,
  server_device_name: String,
  last_change: String,
}

#[derive(Debug, Serialize)]
struct StatusResponse {
  device_id: String,
  device_name: String,
  last_change: String,
}

#[derive(Debug)]
struct DeviceAuth {
  device_id: String,
  device_name: String,
  last_sync_at: Option<String>,
}

impl SyncState {
  pub fn new(port: u16, app_dir: PathBuf) -> Self {
    let store_path = app_dir.join("sync_state.json");
    let mut store = load_store(&store_path);
    if store.device_id.is_empty() {
      store.device_id = generate_id(20);
    }
    if store.device_name.is_empty() {
      store.device_name = default_device_name();
    }
    if store.pair_code.is_empty() {
      store.pair_code = generate_pair_code();
    }
    let _ = save_store(&store_path, &store);
    Self {
      port: if port == 0 { SYNC_PORT_FALLBACK } else { port },
      active: AtomicBool::new(false),
      store_path,
      store: Mutex::new(store),
    }
  }

  pub fn port(&self) -> u16 {
    self.port
  }

  pub fn is_active(&self) -> bool {
    self.active.load(Ordering::Relaxed)
  }

  pub fn set_active(&self, active: bool) {
    self.active.store(active, Ordering::Relaxed);
  }

  pub fn snapshot(&self) -> Result<SyncSnapshot, AppError> {
    let store = self.store.lock()?;
    Ok(SyncSnapshot {
      pair_code: store.pair_code.clone(),
      paired_devices: store
        .paired_devices
        .iter()
        .map(|device| SyncDeviceInfo {
          device_id: device.device_id.clone(),
          device_name: device.device_name.clone(),
          last_sync_at: device.last_sync_at.clone(),
          last_remote_change: device.last_remote_change.clone(),
          last_known_ip: device.last_known_ip.clone(),
        })
        .collect(),
      pending_conflict: store.pending_conflict.as_ref().map(|conflict| SyncConflictInfo {
        device_id: conflict.device_id.clone(),
        device_name: conflict.device_name.clone(),
        local_last_change: conflict.local_last_change.clone(),
        remote_last_change: conflict.remote_last_change.clone(),
        received_at: conflict.received_at.clone(),
        local_summary: conflict.local_summary.clone(),
        remote_summary: conflict.remote_summary.clone(),
      }),
    })
  }

  pub fn pair_device(
    &self,
    code: &str,
    device_id: &str,
    device_name: &str,
    last_known_ip: Option<String>,
  ) -> Result<String, AppError> {
    let mut store = self.store.lock()?;
    if code.trim() != store.pair_code {
      return Err(AppError::new("SYNC_PAIR_CODE", "Pairing-Code stimmt nicht."));
    }

    if let Some(existing) = store.paired_devices.iter_mut().find(|device| device.device_id == device_id) {
      existing.device_name = device_name.to_string();
      if let Some(ip) = last_known_ip {
        existing.last_known_ip = Some(ip);
      }
      let token = existing.token.clone();
      save_store(&self.store_path, &store)?;
      return Ok(token);
    }

    let token = generate_token(TOKEN_LEN);
    store.paired_devices.push(PairedDevice {
      device_id: device_id.to_string(),
      device_name: device_name.to_string(),
      token: token.clone(),
      last_sync_at: None,
      last_remote_change: None,
      last_known_ip,
    });
    save_store(&self.store_path, &store)?;
    Ok(token)
  }

  fn device_for_token(&self, device_id: &str, token: &str) -> Result<Option<PairedDevice>, AppError> {
    let store = self.store.lock()?;
    Ok(store
      .paired_devices
      .iter()
      .find(|device| device.device_id == device_id && device.token == token)
      .cloned())
  }

  pub fn update_device_seen(
    &self,
    device_id: &str,
    device_name: Option<&str>,
    last_known_ip: Option<String>,
    remote_last_change: Option<&str>,
  ) -> Result<(), AppError> {
    let mut store = self.store.lock()?;
    if let Some(device) = store.paired_devices.iter_mut().find(|device| device.device_id == device_id) {
      if let Some(name) = device_name {
        device.device_name = name.to_string();
      }
      if let Some(ip) = last_known_ip {
        device.last_known_ip = Some(ip);
      }
      if let Some(remote) = remote_last_change {
        device.last_remote_change = Some(remote.to_string());
      }
      save_store(&self.store_path, &store)?;
    }
    Ok(())
  }

  pub fn update_device_sync(&self, device_id: &str, remote_last_change: Option<&str>) -> Result<(), AppError> {
    let mut store = self.store.lock()?;
    if let Some(device) = store.paired_devices.iter_mut().find(|device| device.device_id == device_id) {
      device.last_sync_at = Some(Utc::now().to_rfc3339());
      if let Some(remote) = remote_last_change {
        device.last_remote_change = Some(remote.to_string());
      }
      save_store(&self.store_path, &store)?;
    }
    Ok(())
  }

  fn set_pending_conflict(&self, conflict: PendingConflict) -> Result<(), AppError> {
    let mut store = self.store.lock()?;
    store.pending_conflict = Some(conflict);
    save_store(&self.store_path, &store)?;
    Ok(())
  }

  pub fn clear_pending_conflict(&self) -> Result<(), AppError> {
    let mut store = self.store.lock()?;
    store.pending_conflict = None;
    save_store(&self.store_path, &store)?;
    Ok(())
  }

  fn get_pending_conflict(&self) -> Result<Option<PendingConflict>, AppError> {
    let store = self.store.lock()?;
    Ok(store.pending_conflict.clone())
  }

  pub fn device_identity(&self) -> Result<(String, String), AppError> {
    let store = self.store.lock()?;
    Ok((store.device_id.clone(), store.device_name.clone()))
  }
}

pub fn start_sync_server(handle: tauri::AppHandle) {
  std::thread::spawn(move || {
    let state = handle.state::<AppState>();
    let port = state.sync.port();
    let server = Server::http(("0.0.0.0", port));
    match server {
      Ok(server) => {
        state.sync.set_active(true);
        for request in server.incoming_requests() {
          handle_sync_request(request, &state);
        }
        state.sync.set_active(false);
      }
      Err(_) => {
        state.sync.set_active(false);
      }
    }
  });
}

pub fn local_ip_string() -> String {
  local_ip_address::local_ip()
    .map(|ip| ip.to_string())
    .unwrap_or_else(|_| "0.0.0.0".to_string())
}

pub fn get_last_change(conn: &Connection) -> Result<String, AppError> {
  let ts: Option<String> = conn.query_row("SELECT MAX(ts) FROM audit_log", [], |row| row.get(0))?;
  Ok(ts.unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string()))
}

pub fn resolve_sync_conflict(state: &AppState, action: &str) -> Result<(), AppError> {
  let pending = state
    .sync
    .get_pending_conflict()?
    .ok_or_else(|| AppError::new("SYNC_CONFLICT", "Kein Konflikt vorhanden"))?;

  let device_id = pending.device_id.clone();
  let archive_path = pending.archive_path.clone();

  match action {
    "KEEP_LOCAL" => {
      if let Some(path) = archive_path {
        let _ = fs::remove_file(path);
      }
      state.sync.update_device_sync(&device_id, Some(&pending.remote_last_change))?;
      state.sync.clear_pending_conflict()?;
      Ok(())
    }
    "USE_REMOTE" => {
      let archive_path = archive_path.ok_or_else(|| {
        AppError::new("SYNC_CONFLICT", "Kein Remote-Datensatz fuer die Wiederherstellung vorhanden.")
      })?;
      apply_remote_restore(state, &archive_path, Some("SYNC_RESTORE_REMOTE"))?;
      state.sync.update_device_sync(&device_id, Some(&pending.remote_last_change))?;
      state.sync.clear_pending_conflict()?;
      let _ = fs::remove_file(archive_path);
      Ok(())
    }
    "MERGE" => {
      let archive_path = archive_path
        .ok_or_else(|| AppError::new("SYNC_CONFLICT", "Kein Remote-Datensatz zum Mergen vorhanden."))?;
      merge_sync_backup(state, &archive_path)?;
      state.sync.update_device_sync(&device_id, Some(&pending.remote_last_change))?;
      state.sync.clear_pending_conflict()?;
      let _ = fs::remove_file(archive_path);
      Ok(())
    }
    _ => Err(AppError::new("SYNC_CONFLICT", "Unbekannte Konfliktaktion")),
  }
}

fn handle_sync_request(mut request: Request, state: &AppState) {
  let method = request.method().clone();
  let url = request.url().split('?').next().unwrap_or("").to_string();
  let response = match (method, url.as_str()) {
    (Method::Get, "/sync/status") => handle_status(state),
    (Method::Post, "/sync/pair") => handle_pair(&mut request, state),
    (Method::Get, "/sync/backup") => handle_backup(&request, state),
    (Method::Post, "/sync/restore") => handle_restore(&mut request, state),
    _ => json_error(StatusCode(404), "SYNC_NOT_FOUND", "Route nicht gefunden"),
  };
  let _ = request.respond(response);
}

fn handle_status(state: &AppState) -> Response<std::io::Cursor<Vec<u8>>> {
  let status = db::with_conn(&state.db, |conn| get_last_change(conn)).unwrap_or_else(|_| "unknown".to_string());
  let (device_id, device_name) = match state.sync.device_identity() {
    Ok(value) => value,
    Err(_) => ("unknown".to_string(), "unknown".to_string()),
  };
  json_response(
    StatusCode(200),
    &StatusResponse {
      device_id,
      device_name,
      last_change: status,
    },
  )
}

fn handle_pair(request: &mut Request, state: &AppState) -> Response<std::io::Cursor<Vec<u8>>> {
  let mut body = Vec::new();
  if request.as_reader().read_to_end(&mut body).is_err() {
    return json_error(StatusCode(400), "SYNC_PAIR", "Pairing-Daten konnten nicht gelesen werden.");
  }
  let payload: PairRequest = match serde_json::from_slice(&body) {
    Ok(payload) => payload,
    Err(_) => return json_error(StatusCode(400), "SYNC_PAIR", "Pairing-Daten sind ungueltig."),
  };

  let remote_ip = request.remote_addr().map(|addr| addr.ip().to_string());
  let token = match state
    .sync
    .pair_device(&payload.code, &payload.device_id, &payload.device_name, remote_ip)
  {
    Ok(token) => token,
    Err(err) => return json_error(StatusCode(401), &err.code, &err.message),
  };

  let last_change = db::with_conn(&state.db, |conn| get_last_change(conn)).unwrap_or_else(|_| "unknown".to_string());
  let (server_device_id, server_device_name) = match state.sync.device_identity() {
    Ok(value) => value,
    Err(_) => ("unknown".to_string(), "unknown".to_string()),
  };

  json_response(
    StatusCode(200),
    &PairResponse {
      device_token: token,
      server_device_id,
      server_device_name,
      last_change,
    },
  )
}

fn handle_backup(request: &Request, state: &AppState) -> Response<std::io::Cursor<Vec<u8>>> {
  let auth = match authorize_request(request, state) {
    Ok(auth) => auth,
    Err(response) => return response,
  };

  let remote_last_change = match read_remote_last_change(request) {
    Ok(value) => value,
    Err(response) => return response,
  };

  let local_last_change = db::with_conn(&state.db, |conn| get_last_change(conn)).unwrap_or_else(|_| "unknown".to_string());
  if has_conflict(auth.last_sync_at.as_deref(), &local_last_change, &remote_last_change) {
    let _ = state.sync.set_pending_conflict(PendingConflict {
      device_id: auth.device_id.clone(),
      device_name: auth.device_name.clone(),
      local_last_change: local_last_change.clone(),
      remote_last_change: remote_last_change.clone(),
      received_at: Utc::now().to_rfc3339(),
      archive_path: None,
      local_summary: build_conflict_summary(&state.db).ok(),
      remote_summary: None,
    });
    return json_error(StatusCode(409), "SYNC_CONFLICT", "Beide Seiten wurden geaendert.");
  }

  if !is_after(&local_last_change, &remote_last_change) {
    let _ = state
      .sync
      .update_device_seen(&auth.device_id, None, None, Some(&remote_last_change));
    return json_error(StatusCode(409), "SYNC_REMOTE_NEWER", "Remote-Daten sind aktueller.");
  }

  let temp_dir = state.app_dir.join("SyncTemp");
  let _ = fs::create_dir_all(&temp_dir);
  let filename = temp_dir.join(format!("sync_backup_{}.zip", Utc::now().timestamp()));

  let _ = db::with_conn(&state.db, |conn| db::checkpoint(conn));
  let backup_path = match backup::create_backup(
    &state.app_dir,
    &state.db.db_path,
    &state.receipt_base,
    true,
    Some(filename.to_string_lossy().to_string()),
  ) {
    Ok(path) => path,
    Err(err) => return json_error(StatusCode(500), &err.code, &err.message),
  };

  let file_bytes = match fs::read(&backup_path) {
    Ok(bytes) => bytes,
    Err(err) => {
      let message = err.to_string();
      return json_error(StatusCode(500), "SYNC_BACKUP", &message);
    }
  };
  schedule_cleanup(PathBuf::from(&backup_path));

  let _ = state
    .sync
    .update_device_sync(&auth.device_id, Some(&remote_last_change));

  let mut response = Response::from_data(file_bytes);
  response.add_header(json_header("Content-Type", "application/zip"));
  response
}

fn handle_restore(request: &mut Request, state: &AppState) -> Response<std::io::Cursor<Vec<u8>>> {
  let auth = match authorize_request(request, state) {
    Ok(auth) => auth,
    Err(response) => return response,
  };

  let remote_last_change = match read_remote_last_change(request) {
    Ok(value) => value,
    Err(response) => return response,
  };

  let mut body = Vec::new();
  if request.as_reader().read_to_end(&mut body).is_err() {
    return json_error(StatusCode(400), "SYNC_RESTORE", "Backup konnte nicht gelesen werden.");
  }

  let local_last_change = db::with_conn(&state.db, |conn| get_last_change(conn)).unwrap_or_else(|_| "unknown".to_string());
  if has_conflict(auth.last_sync_at.as_deref(), &local_last_change, &remote_last_change) {
    let conflict_path = store_conflict_archive(state, &auth.device_id, &body);
    let local_summary = build_conflict_summary(&state.db).ok();
    let remote_summary = conflict_path
      .as_deref()
      .and_then(|path| build_remote_summary(path).ok().flatten());

    let _ = state.sync.set_pending_conflict(PendingConflict {
      device_id: auth.device_id.clone(),
      device_name: auth.device_name.clone(),
      local_last_change: local_last_change.clone(),
      remote_last_change: remote_last_change.clone(),
      received_at: Utc::now().to_rfc3339(),
      archive_path: conflict_path,
      local_summary,
      remote_summary,
    });
    return json_error(StatusCode(409), "SYNC_CONFLICT", "Beide Seiten wurden geaendert.");
  }

  if !is_after(&remote_last_change, &local_last_change) {
    let _ = state
      .sync
      .update_device_seen(&auth.device_id, None, None, Some(&remote_last_change));
    return json_error(StatusCode(409), "SYNC_LOCAL_NEWER", "Lokale Daten sind aktueller.");
  }

  let temp_dir = state.app_dir.join("SyncTemp");
  let _ = fs::create_dir_all(&temp_dir);
  let archive_path = temp_dir.join(format!("sync_restore_{}.zip", Utc::now().timestamp()));
  if fs::write(&archive_path, &body).is_err() {
    return json_error(StatusCode(500), "SYNC_RESTORE", "Backup konnte nicht gespeichert werden.");
  }

  if let Err(err) = apply_remote_restore(state, archive_path.to_string_lossy().as_ref(), Some("SYNC_RESTORE")) {
    return json_error(StatusCode(500), &err.code, &err.message);
  }
  let _ = fs::remove_file(&archive_path);

  let _ = state
    .sync
    .update_device_sync(&auth.device_id, Some(&remote_last_change));
  json_response(StatusCode(200), &serde_json::json!({ "ok": true }))
}

fn apply_remote_restore(state: &AppState, archive_path: &str, audit_action: Option<&str>) -> Result<(), AppError> {
  let _ = db::with_conn(&state.db, |conn| db::checkpoint(conn));
  backup::restore_backup(archive_path, &state.db.db_path, &state.receipt_base)?;
  db::reload_connection(&state.db)?;

  db::with_conn(&state.db, |conn| {
    fix_receipt_paths(conn, &state.receipt_base)?;
    ensure_receipt_setting(conn, &state.receipt_base)?;
    if let Some(action) = audit_action {
      append_audit(
        conn,
        Some("sync".to_string()),
        action,
        "SYNC",
        None,
        None,
        "{}".to_string(),
        Some("Restore via lokalem Sync".to_string()),
      )?;
    }
    Ok(())
  })?;

  Ok(())
}

fn merge_sync_backup(state: &AppState, archive_path: &str) -> Result<(), AppError> {
  let temp_dir = std::env::temp_dir().join(format!("pizza_damico_sync_merge_{}", Utc::now().timestamp()));
  fs::create_dir_all(&temp_dir)?;
  let temp_db = temp_dir.join("db.sqlite");
  let temp_receipts = temp_dir.join("receipts");

  backup::restore_backup(archive_path, &temp_db, &temp_receipts)?;
  let remote_conn = Connection::open(&temp_db)?;

  copy_remote_receipts(&temp_receipts, &state.receipt_base)?;

  db::with_conn(&state.db, |conn| {
    merge_categories(conn, &remote_conn)?;
    merge_transactions(conn, &remote_conn, &state.receipt_base)?;
    merge_month_closing(conn, &remote_conn)?;
    ensure_receipt_setting(conn, &state.receipt_base)?;
    append_audit(
      conn,
      Some("sync".to_string()),
      "SYNC_MERGE",
      "SYNC",
      None,
      None,
      "{}".to_string(),
      Some("Merge via lokalem Sync".to_string()),
    )?;
    Ok(())
  })?;

  Ok(())
}

fn merge_categories(local: &Connection, remote: &Connection) -> Result<(), AppError> {
  let mut stmt = remote.prepare("SELECT name, description, default_mwst_rate, is_active FROM categories")?;
  let rows = stmt.query_map([], |row| {
    Ok((
      row.get::<_, String>(0)?,
      row.get::<_, Option<String>>(1)?,
      row.get::<_, f64>(2)?,
      row.get::<_, i64>(3)?,
    ))
  })?;

  for row in rows {
    let (name, description, rate, is_active) = row?;
    let existing: Option<i64> = local
      .query_row("SELECT id FROM categories WHERE name = ?1", params![name], |row| row.get(0))
      .optional()?;
    if existing.is_none() {
      local.execute(
        "INSERT INTO categories (name, description, default_mwst_rate, is_active) VALUES (?1, ?2, ?3, ?4)",
        params![name, description, rate, is_active],
      )?;
    }
  }
  Ok(())
}

fn merge_transactions(local: &Connection, remote: &Connection, receipt_base: &Path) -> Result<(), AppError> {
  let mut category_map: HashMap<String, i64> = HashMap::new();
  let mut stmt = local.prepare("SELECT id, name FROM categories")?;
  let rows = stmt.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))?;
  for row in rows {
    let (id, name) = row?;
    category_map.insert(name, id);
  }

  let receipt_map = build_receipt_name_map(receipt_base);

  let mut stmt = remote.prepare(
    "SELECT public_id, date, year, month, type, payment_method, category_id, description, amount_chf, mwst_rate, receipt_path, note, ref_public_id, created_at, updated_at\n     FROM transactions",
  )?;
  let rows = stmt.query_map([], |row| {
    Ok((
      row.get::<_, String>(0)?,
      row.get::<_, String>(1)?,
      row.get::<_, i32>(2)?,
      row.get::<_, i32>(3)?,
      row.get::<_, String>(4)?,
      row.get::<_, Option<String>>(5)?,
      row.get::<_, Option<i64>>(6)?,
      row.get::<_, Option<String>>(7)?,
      row.get::<_, f64>(8)?,
      row.get::<_, f64>(9)?,
      row.get::<_, Option<String>>(10)?,
      row.get::<_, Option<String>>(11)?,
      row.get::<_, Option<String>>(12)?,
      row.get::<_, String>(13)?,
      row.get::<_, String>(14)?,
    ))
  })?;

  for row in rows {
    let (
      public_id,
      date,
      year,
      month,
      tx_type,
      payment_method,
      category_id,
      description,
      amount_chf,
      mwst_rate,
      receipt_path,
      note,
      ref_public_id,
      created_at,
      updated_at,
    ) = row?;

    let category_name = match category_id {
      Some(id) => remote
        .query_row("SELECT name FROM categories WHERE id = ?1", params![id], |row| row.get::<_, String>(0))
        .ok(),
      None => None,
    };
    let mapped_category_id = category_name.as_ref().and_then(|name| category_map.get(name).copied());

    let mapped_receipt_path = receipt_path
      .as_deref()
      .and_then(|path| map_receipt_path(path, receipt_base, &receipt_map));

    let existing: Option<(String, Option<String>)> = local
      .query_row(
        "SELECT updated_at, receipt_path FROM transactions WHERE public_id = ?1",
        params![public_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
      )
      .optional()?;

    if let Some((local_updated_at, existing_receipt_path)) = existing {
      if is_after(&updated_at, &local_updated_at) {
        let receipt_value = mapped_receipt_path.or(existing_receipt_path);
        local.execute(
          "UPDATE transactions SET date = ?2, year = ?3, month = ?4, type = ?5, payment_method = ?6, category_id = ?7, description = ?8,\n           amount_chf = ?9, mwst_rate = ?10, receipt_path = ?11, note = ?12, ref_public_id = ?13, created_at = ?14, updated_at = ?15 WHERE public_id = ?1",
          params![
            public_id,
            date,
            year,
            month,
            tx_type,
            payment_method,
            mapped_category_id,
            description,
            amount_chf,
            mwst_rate,
            receipt_value,
            note,
            ref_public_id,
            created_at,
            updated_at,
          ],
        )?;
      }
    } else {
      local.execute(
        "INSERT INTO transactions (public_id, date, year, month, type, payment_method, category_id, description, amount_chf, mwst_rate, receipt_path, note, ref_public_id, created_at, updated_at)\n         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
          public_id,
          date,
          year,
          month,
          tx_type,
          payment_method,
          mapped_category_id,
          description,
          amount_chf,
          mwst_rate,
          mapped_receipt_path,
          note,
          ref_public_id,
          created_at,
          updated_at,
        ],
      )?;
    }
  }

  Ok(())
}

fn merge_month_closing(local: &Connection, remote: &Connection) -> Result<(), AppError> {
  let mut stmt = remote.prepare("SELECT year, month, is_closed, closed_at, closed_by FROM month_closing")?;
  let rows = stmt.query_map([], |row| {
    Ok((
      row.get::<_, i32>(0)?,
      row.get::<_, i32>(1)?,
      row.get::<_, i64>(2)?,
      row.get::<_, Option<String>>(3)?,
      row.get::<_, Option<String>>(4)?,
    ))
  })?;

  for row in rows {
    let (year, month, is_closed, closed_at, closed_by) = row?;
    let existing: Option<(i64, Option<String>)> = local
      .query_row(
        "SELECT is_closed, closed_at FROM month_closing WHERE year = ?1 AND month = ?2",
        params![year, month],
        |row| Ok((row.get(0)?, row.get(1)?)),
      )
      .optional()?;

    match existing {
      Some((local_closed, local_closed_at)) => {
        if is_closed == 1 && local_closed == 0 {
          local.execute(
            "UPDATE month_closing SET is_closed = 1, closed_at = ?3, closed_by = ?4 WHERE year = ?1 AND month = ?2",
            params![year, month, closed_at, closed_by],
          )?;
        } else if is_closed == 1 && local_closed == 1 {
          let remote_time = closed_at.clone().unwrap_or_default();
          let local_time = local_closed_at.unwrap_or_default();
          if is_after(&remote_time, &local_time) {
            local.execute(
              "UPDATE month_closing SET closed_at = ?3, closed_by = ?4 WHERE year = ?1 AND month = ?2",
              params![year, month, closed_at, closed_by],
            )?;
          }
        }
      }
      None => {
        local.execute(
          "INSERT INTO month_closing (year, month, is_closed, closed_at, closed_by) VALUES (?1, ?2, ?3, ?4, ?5)",
          params![year, month, is_closed, closed_at, closed_by],
        )?;
      }
    }
  }

  Ok(())
}

fn build_conflict_summary(db: &crate::db::Db) -> Result<SyncConflictSummary, AppError> {
  db::with_conn(db, |conn| build_summary_from_conn(conn))
}

fn build_summary_from_conn(conn: &Connection) -> Result<SyncConflictSummary, AppError> {
  let tx_count: i64 = conn.query_row("SELECT COUNT(*) FROM transactions", [], |row| row.get(0))?;
  let income_total: f64 = conn.query_row(
    "SELECT COALESCE(SUM(amount_chf), 0) FROM transactions WHERE type = 'INCOME'",
    [],
    |row| row.get(0),
  )?;
  let expense_total: f64 = conn.query_row(
    "SELECT COALESCE(SUM(amount_chf), 0) FROM transactions WHERE type = 'EXPENSE'",
    [],
    |row| row.get(0),
  )?;

  let mut stmt = conn.prepare(
    "SELECT t.date, t.type, t.amount_chf, t.payment_method, t.description, c.name\n     FROM transactions t\n     LEFT JOIN categories c ON t.category_id = c.id\n     ORDER BY t.updated_at DESC\n     LIMIT 5",
  )?;
  let rows = stmt.query_map([], |row| {
    Ok((
      row.get::<_, String>(0)?,
      row.get::<_, String>(1)?,
      row.get::<_, f64>(2)?,
      row.get::<_, Option<String>>(3)?,
      row.get::<_, Option<String>>(4)?,
      row.get::<_, Option<String>>(5)?,
    ))
  })?;

  let mut items = Vec::new();
  for row in rows {
    let (date, tx_type, amount_chf, payment, description, category) = row?;
    let label = description
      .or(category)
      .or(payment)
      .unwrap_or_else(|| "Buchung".to_string());
    items.push(SyncConflictItem {
      date,
      label,
      amount_chf,
      tx_type,
    });
  }

  Ok(SyncConflictSummary {
    tx_count,
    income_total,
    expense_total,
    last_items: items,
  })
}

fn build_remote_summary(path: &str) -> Result<Option<SyncConflictSummary>, AppError> {
  let temp_dir = std::env::temp_dir().join(format!("pizza_damico_sync_preview_{}", Utc::now().timestamp()));
  fs::create_dir_all(&temp_dir)?;
  let temp_db = temp_dir.join("db.sqlite");
  let temp_receipts = temp_dir.join("receipts");
  backup::restore_backup(path, &temp_db, &temp_receipts)?;
  let conn = Connection::open(&temp_db)?;
  let summary = build_summary_from_conn(&conn)?;
  Ok(Some(summary))
}

fn ensure_receipt_setting(conn: &Connection, receipt_base: &Path) -> Result<(), AppError> {
  let value = receipt_base.to_string_lossy().to_string();
  conn.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
    params!["receipt_base_folder", value],
  )?;
  Ok(())
}

fn fix_receipt_paths(conn: &Connection, receipt_base: &Path) -> Result<(), AppError> {
  let receipt_map = build_receipt_name_map(receipt_base);
  let mut stmt = conn.prepare("SELECT public_id, receipt_path FROM transactions WHERE receipt_path IS NOT NULL")?;
  let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
  for row in rows {
    let (public_id, receipt_path) = row?;
    if receipt_path.starts_with(receipt_base.to_string_lossy().as_ref()) && Path::new(&receipt_path).exists() {
      continue;
    }
    if let Some(mapped) = map_receipt_path(&receipt_path, receipt_base, &receipt_map) {
      conn.execute(
        "UPDATE transactions SET receipt_path = ?1 WHERE public_id = ?2",
        params![mapped, public_id],
      )?;
    }
  }
  Ok(())
}

fn copy_remote_receipts(remote_base: &Path, local_base: &Path) -> Result<(), AppError> {
  if !remote_base.exists() {
    return Ok(());
  }
  for entry in WalkDir::new(remote_base).into_iter().filter_map(Result::ok) {
    if entry.file_type().is_file() {
      let rel = entry.path().strip_prefix(remote_base).unwrap_or(entry.path());
      let target = local_base.join(rel);
      if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
      }
      if !target.exists() {
        let _ = fs::copy(entry.path(), target);
      }
    }
  }
  Ok(())
}

fn build_receipt_name_map(receipt_base: &Path) -> HashMap<String, PathBuf> {
  let mut map = HashMap::new();
  if !receipt_base.exists() {
    return map;
  }
  for entry in WalkDir::new(receipt_base).into_iter().filter_map(Result::ok) {
    if entry.file_type().is_file() {
      if let Some(name) = entry.path().file_name().and_then(|v| v.to_str()) {
        map.entry(name.to_string()).or_insert_with(|| entry.path().to_path_buf());
      }
    }
  }
  map
}

fn map_receipt_path(path: &str, receipt_base: &Path, name_map: &HashMap<String, PathBuf>) -> Option<String> {
  let path_ref = Path::new(path);
  let mut components: Vec<String> = path_ref
    .components()
    .map(|component| component.as_os_str().to_string_lossy().to_string())
    .collect();

  if let Some(index) = components
    .iter()
    .position(|component| component.eq_ignore_ascii_case("Belege"))
  {
    let rel_components = components.split_off(index + 1);
    let mut candidate = receipt_base.to_path_buf();
    for part in rel_components {
      candidate = candidate.join(part);
    }
    if candidate.exists() {
      return Some(candidate.to_string_lossy().to_string());
    }
  }

  if let Some(file_name) = path_ref.file_name().and_then(|name| name.to_str()) {
    if let Some(candidate) = name_map.get(file_name) {
      return Some(candidate.to_string_lossy().to_string());
    }
  }
  None
}

fn authorize_request(request: &Request, state: &AppState) -> Result<DeviceAuth, Response<std::io::Cursor<Vec<u8>>>> {
  let device_id = match read_header(request, "X-Pizza-Device-Id") {
    Some(value) => value,
    None => return Err(json_error(StatusCode(401), "SYNC_AUTH", "Device-ID fehlt.")),
  };
  let token = match read_header(request, "X-Pizza-Device-Token") {
    Some(value) => value,
    None => return Err(json_error(StatusCode(401), "SYNC_AUTH", "Device-Token fehlt.")),
  };
  let device = match state.sync.device_for_token(&device_id, &token) {
    Ok(Some(device)) => device,
    _ => return Err(json_error(StatusCode(401), "SYNC_AUTH", "Zugriff verweigert.")),
  };
  let remote_ip = request.remote_addr().map(|addr| addr.ip().to_string());
  let _ = state
    .sync
    .update_device_seen(&device.device_id, Some(&device.device_name), remote_ip, None);
  Ok(DeviceAuth {
    device_id: device.device_id,
    device_name: device.device_name,
    last_sync_at: device.last_sync_at,
  })
}

fn read_remote_last_change(request: &Request) -> Result<String, Response<std::io::Cursor<Vec<u8>>>> {
  read_header(request, "X-Pizza-Remote-Last-Change")
    .ok_or_else(|| json_error(StatusCode(400), "SYNC_REMOTE_CHANGE", "Remote-Stand fehlt."))
}

fn read_header(request: &Request, name: &str) -> Option<String> {
  request
    .headers()
    .iter()
    .find(|header| header.field.as_str().as_str().eq_ignore_ascii_case(name))
    .map(|header| header.value.to_string())
}

fn has_conflict(last_sync_at: Option<&str>, local_last: &str, remote_last: &str) -> bool {
  if let Some(last_sync) = last_sync_at {
    is_after(local_last, last_sync) && is_after(remote_last, last_sync)
  } else {
    false
  }
}

fn is_after(lhs: &str, rhs: &str) -> bool {
  match (parse_rfc3339(lhs), parse_rfc3339(rhs)) {
    (Some(a), Some(b)) => a > b,
    _ => lhs > rhs,
  }
}

fn parse_rfc3339(value: &str) -> Option<DateTime<Utc>> {
  DateTime::parse_from_rfc3339(value).ok().map(|dt| dt.with_timezone(&Utc))
}

fn json_response<T: Serialize>(status: StatusCode, payload: &T) -> Response<std::io::Cursor<Vec<u8>>> {
  let body = serde_json::to_vec(payload).unwrap_or_else(|_| b"{}".to_vec());
  let mut response = Response::from_data(body);
  response = response.with_status_code(status);
  response.add_header(json_header("Content-Type", "application/json"));
  response
}

fn json_error(status: StatusCode, code: &str, message: &str) -> Response<std::io::Cursor<Vec<u8>>> {
  json_response(
    status,
    &serde_json::json!({
      "code": code,
      "message": message,
    }),
  )
}

fn json_header(name: &str, value: &str) -> Header {
  Header::from_bytes(name, value).unwrap()
}

fn generate_pair_code() -> String {
  let mut rng = rand::thread_rng();
  (0..PAIR_CODE_LEN).map(|_| rng.gen_range(0..10).to_string()).collect()
}

fn generate_token(length: usize) -> String {
  rand::thread_rng()
    .sample_iter(&Alphanumeric)
    .take(length)
    .map(char::from)
    .collect()
}

fn generate_id(length: usize) -> String {
  generate_token(length)
}

fn default_device_name() -> String {
  std::env::var("COMPUTERNAME")
    .or_else(|_| std::env::var("HOSTNAME"))
    .unwrap_or_else(|_| "Pizza Damico".to_string())
}

fn load_store(path: &Path) -> SyncStore {
  if let Ok(data) = fs::read_to_string(path) {
    if let Ok(store) = serde_json::from_str::<SyncStore>(&data) {
      return store;
    }
  }
  SyncStore {
    device_id: String::new(),
    device_name: String::new(),
    pair_code: generate_pair_code(),
    paired_devices: Vec::new(),
    pending_conflict: None,
  }
}

fn save_store(path: &Path, store: &SyncStore) -> Result<(), AppError> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)?;
  }
  let data = serde_json::to_string_pretty(store)
    .map_err(|err| AppError::new("SYNC_STORE", err.to_string()))?;
  fs::write(path, data)?;
  Ok(())
}

fn store_conflict_archive(state: &AppState, device_id: &str, body: &[u8]) -> Option<String> {
  let conflict_dir = state.app_dir.join("SyncConflicts");
  if fs::create_dir_all(&conflict_dir).is_err() {
    return None;
  }
  let filename = conflict_dir.join(format!("conflict_{}_{}.zip", device_id, Utc::now().timestamp()));
  if fs::write(&filename, body).is_err() {
    return None;
  }
  Some(filename.to_string_lossy().to_string())
}

fn schedule_cleanup(path: PathBuf) {
  std::thread::spawn(move || {
    std::thread::sleep(Duration::from_secs(90));
    let _ = fs::remove_file(path);
  });
}
