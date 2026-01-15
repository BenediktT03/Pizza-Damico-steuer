type TooltipPayload = {
  name?: string;
  value?: number | string;
  payload?: Record<string, unknown>;
};

type ChartTooltipProps = {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string | number;
  valueFormatter?: (value: number) => string;
  labelFormatter?: (label: string | number) => string;
};

function formatValue(value: number | string | undefined, formatter?: (value: number) => string): string {
  if (formatter) {
    const numeric = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
    if (!Number.isNaN(numeric)) {
      return formatter(numeric);
    }
  }
  if (value === undefined || value === null) return "-";
  return String(value);
}

function resolveName(entry: TooltipPayload): string {
  if (entry.name) return String(entry.name);
  if (entry.payload && typeof entry.payload === "object") {
    const record = entry.payload as Record<string, unknown>;
    const fallback = record.payment_method ?? record.category ?? record.name;
    if (typeof fallback === "string" && fallback.trim().length > 0) {
      return fallback;
    }
  }
  return "-";
}

export function ChartTooltip({ active, payload, label, valueFormatter, labelFormatter }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const labelText =
    label === undefined || label === null || label === ""
      ? ""
      : labelFormatter
      ? labelFormatter(label)
      : String(label);
  const rows = payload.filter((entry) => entry && entry.value !== undefined);

  if (rows.length === 0) return null;

  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-card"
      style={{
        background: "var(--color-app-card)",
        border: "1px solid var(--color-app-border)",
        color: "var(--color-app-primary)",
      }}
    >
      {labelText && (
        <div className="mb-1 text-xs" style={{ color: "var(--color-app-neutral)" }}>
          {labelText}
        </div>
      )}
      <div className="space-y-1">
        {rows.map((entry, index) => {
          const name = resolveName(entry);
          const valueText = formatValue(entry.value, valueFormatter);
          return (
            <div key={`${name}-${index}`} className="flex items-center justify-between gap-3">
              <span style={{ color: "var(--color-app-neutral)" }}>{name}</span>
              <span className="font-medium" style={{ color: "var(--color-app-primary)" }}>
                {valueText}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
