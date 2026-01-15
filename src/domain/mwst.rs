pub fn mwst_from_brutto(brutto: f64, rate: f64) -> f64 {
  if rate <= 0.0 {
    0.0
  } else {
    brutto * (rate / (100.0 + rate))
  }
}

pub fn effective_due(mwst_income: f64, mwst_expense: f64) -> f64 {
  mwst_income - mwst_expense
}

pub fn saldo_due(income_total: f64, saldo_rate: f64) -> f64 {
  income_total * (saldo_rate / 100.0)
}

pub fn safe_margin(result: f64, income_total: f64) -> f64 {
  if income_total.abs() < f64::EPSILON {
    0.0
  } else {
    result / income_total
  }
}
