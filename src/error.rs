use serde::Serialize;
use rust_xlsxwriter::XlsxError;

#[derive(Debug, Serialize)]
pub struct AppError {
  pub code: String,
  pub message: String,
}

impl AppError {
  pub fn new(code: &str, message: impl Into<String>) -> Self {
    Self {
      code: code.to_string(),
      message: message.into(),
    }
  }
}

impl std::fmt::Display for AppError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "{}: {}", self.code, self.message)
  }
}

impl std::error::Error for AppError {}

impl From<rusqlite::Error> for AppError {
  fn from(err: rusqlite::Error) -> Self {
    AppError::new("DB_ERROR", err.to_string())
  }
}

impl From<std::io::Error> for AppError {
  fn from(err: std::io::Error) -> Self {
    AppError::new("IO_ERROR", err.to_string())
  }
}

impl From<zip::result::ZipError> for AppError {
  fn from(err: zip::result::ZipError) -> Self {
    AppError::new("ZIP_ERROR", err.to_string())
  }
}

impl From<XlsxError> for AppError {
  fn from(err: XlsxError) -> Self {
    AppError::new("EXPORT", err.to_string())
  }
}

impl<T> From<std::sync::PoisonError<T>> for AppError {
  fn from(_: std::sync::PoisonError<T>) -> Self {
    AppError::new("LOCK_ERROR", "Database lock failed")
  }
}
