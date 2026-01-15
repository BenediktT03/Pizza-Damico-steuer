import { format } from "date-fns";

export function formatCHF(value: number, locale = "de-CH") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "CHF",
    minimumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number, locale = "de-CH") {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDate(isoDate: string, locale = "de-CH") {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.valueOf())) return isoDate;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function formatIsoDate(date: Date) {
  return format(date, "yyyy-MM-dd");
}
