export function parseDecimalInput(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    let normalized = value.trim();
    if (!normalized) return undefined;
    normalized = normalized.replace(/[\s'\u2019]/g, "");
    if (normalized.includes(",") && normalized.includes(".")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(",", ".");
    }
    if (!normalized) return undefined;
    const numberValue = Number(normalized);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }
  return undefined;
}
