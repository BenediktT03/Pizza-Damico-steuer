use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;

use chrono::Utc;
use walkdir::WalkDir;
use zip::write::FileOptions;
use zip::{ZipArchive, ZipWriter};

use crate::error::AppError;

pub fn create_backup(
  app_dir: &Path,
  db_path: &Path,
  receipt_base: &Path,
  include_receipts: bool,
  output_path: Option<String>,
) -> Result<String, AppError> {
  let backup_dir = app_dir.join("Backups");
  fs::create_dir_all(&backup_dir)?;

  let filename = output_path.unwrap_or_else(|| {
    let stamp = Utc::now().format("%Y%m%d_%H%M");
    backup_dir
      .join(format!("backup_{stamp}.zip"))
      .to_string_lossy()
      .to_string()
  });

  if let Some(parent) = Path::new(&filename).parent() {
    fs::create_dir_all(parent)?;
  }

  let file = File::create(&filename)?;
  let mut zip = ZipWriter::new(file);
  let options = FileOptions::<()>::default().compression_method(zip::CompressionMethod::Deflated);

  zip.start_file("db.sqlite", options)?;
  let mut db_file = File::open(db_path)?;
  let mut buffer = Vec::new();
  db_file.read_to_end(&mut buffer)?;
  zip.write_all(&buffer)?;

  if include_receipts && receipt_base.exists() {
    for entry in WalkDir::new(receipt_base).into_iter().filter_map(Result::ok) {
      if entry.file_type().is_file() {
        let path = entry.path();
        let rel = path.strip_prefix(receipt_base).unwrap_or(path);
        let archive_name = Path::new("receipts").join(rel).to_string_lossy().to_string();
        zip.start_file(archive_name, options)?;
        let mut file = File::open(path)?;
        let mut data = Vec::new();
        file.read_to_end(&mut data)?;
        zip.write_all(&data)?;
      }
    }
  }

  zip.finish()?;
  Ok(filename)
}

pub fn restore_backup(
  archive_path: &str,
  db_path: &Path,
  receipt_base: &Path,
) -> Result<(), AppError> {
  let file = File::open(archive_path)?;
  let mut archive = ZipArchive::new(file)?;

  let temp_dir = std::env::temp_dir().join(format!("pizza_damico_restore_{}", Utc::now().timestamp()));
  fs::create_dir_all(&temp_dir)?;

  for i in 0..archive.len() {
    let mut file = archive.by_index(i)?;
    let outpath = temp_dir.join(file.name());

    if (&*file.name()).ends_with('/') {
      fs::create_dir_all(&outpath)?;
    } else {
      if let Some(parent) = outpath.parent() {
        fs::create_dir_all(parent)?;
      }
      let mut outfile = File::create(&outpath)?;
      std::io::copy(&mut file, &mut outfile)?;
    }
  }

  let restored_db = temp_dir.join("db.sqlite");
  if restored_db.exists() {
    if db_path.exists() {
      let backup_path = db_path.with_extension("bak");
      fs::copy(db_path, backup_path)?;
    }
    fs::copy(restored_db, db_path)?;
  }

  let restored_receipts = temp_dir.join("receipts");
  if restored_receipts.exists() {
    fs::create_dir_all(receipt_base)?;
    for entry in WalkDir::new(&restored_receipts).into_iter().filter_map(Result::ok) {
      if entry.file_type().is_file() {
        let rel = entry.path().strip_prefix(&restored_receipts).unwrap_or(entry.path());
        let target = receipt_base.join(rel);
        if let Some(parent) = target.parent() {
          fs::create_dir_all(parent)?;
        }
        fs::copy(entry.path(), target)?;
      }
    }
  }

  Ok(())
}
