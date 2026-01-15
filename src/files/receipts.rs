use std::fs;
use std::path::{Path, PathBuf};

use crate::error::AppError;

pub fn ensure_receipt_base(app_dir: &Path) -> Result<PathBuf, AppError> {
  let receipt_dir = app_dir.join("Belege");
  fs::create_dir_all(&receipt_dir)?;
  Ok(receipt_dir)
}

pub fn copy_receipt(
  source_path: &str,
  receipt_base: &Path,
  year: i32,
  month: i32,
  public_id: &str,
) -> Result<String, AppError> {
  let source = Path::new(source_path);
  if !source.exists() {
    return Err(AppError::new("RECEIPT_NOT_FOUND", "Belegdatei nicht gefunden"));
  }

  let month_dir = receipt_base.join(format!("{year}")).join(format!("{month:02}"));
  fs::create_dir_all(&month_dir)?;

  let ext = source.extension().and_then(|v| v.to_str()).unwrap_or("bin");
  let base_name = format!("Beleg_{public_id}");
  let mut candidate = month_dir.join(format!("{base_name}.{ext}"));
  let mut counter = 1;
  while candidate.exists() {
    candidate = month_dir.join(format!("{base_name}_{counter}.{ext}"));
    counter += 1;
  }

  fs::copy(source, &candidate)?;
  Ok(candidate.to_string_lossy().to_string())
}

pub fn open_receipt(path: &str) -> Result<(), AppError> {
  if path.trim().is_empty() {
    return Err(AppError::new("RECEIPT_PATH_EMPTY", "Belegpfad fehlt"));
  }
  open::that(path).map_err(|err| AppError::new("RECEIPT_OPEN", err.to_string()))?;
  Ok(())
}
