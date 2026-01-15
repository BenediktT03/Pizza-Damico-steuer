import { cn } from "../../lib/utils";

interface KpiCardProps {
  label: string;
  value: string;
  accent?: "positive" | "warning" | "danger" | "neutral";
  hint?: string;
}

const accentStyles = {
  positive: "text-app-positive",
  warning: "text-app-warning",
  danger: "text-app-danger",
  neutral: "text-app-primary",
};

const accentBars = {
  positive: "bg-app-positive",
  warning: "bg-app-warning",
  danger: "bg-app-danger",
  neutral: "bg-app-border",
};

export function KpiCard({ label, value, accent = "neutral", hint }: KpiCardProps) {
  return (
    <div className="kpi-card">
      <div className={cn("absolute left-0 top-0 h-full w-1", accentBars[accent])} />
      <div className="pl-2">
        <div className="kpi-label">{label}</div>
        <div className={cn("kpi-value", accentStyles[accent])}>{value}</div>
        {hint && <div className="text-xs text-app-neutral">{hint}</div>}
      </div>
    </div>
  );
}
