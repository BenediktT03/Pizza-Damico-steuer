import { useMemo } from "react";

import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { useI18n } from "../../lib/i18n";
import { useAppStore } from "../../state/appStore";

export function MonthToolbar() {
  const { year, month, setYear, setMonth } = useAppStore();
  const { t, monthNamesLong, monthNamesShort } = useI18n();

  const years = useMemo(() => Array.from({ length: 6 }, (_, idx) => year - 3 + idx), [year]);
  const activeMonth = monthNamesLong[month - 1] ?? monthNamesShort[month - 1];

  const moveMonth = (direction: -1 | 1) => {
    const nextMonth = direction === -1 ? (month === 1 ? 12 : month - 1) : month === 12 ? 1 : month + 1;
    const nextYear = direction === -1 ? (month === 1 ? year - 1 : year) : month === 12 ? year + 1 : year;
    setMonth(nextMonth);
    setYear(nextYear);
  };

  return (
    <div className="rounded-2xl border border-app-border bg-app-card px-4 py-3 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[140px] text-sm font-semibold text-app-primary">
          {activeMonth} {year}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => moveMonth(-1)}>
            {t("actions.previous")}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => moveMonth(1)}>
            {t("actions.next")}
          </Button>
        </div>
        <div className="flex-1 overflow-x-auto">
          <div className="flex min-w-max items-center gap-1 rounded-xl border border-app-border bg-app-surface p-1">
            {monthNamesShort.map((label, idx) => {
              const isActive = month === idx + 1;
              return (
                <button
                  key={label}
                  className={`min-w-[44px] rounded-lg px-2 py-1 text-xs font-semibold transition ${
                    isActive ? "bg-app-accent text-white" : "text-app-neutral hover:bg-app-muted"
                  }`}
                  onClick={() => setMonth(idx + 1)}
                  type="button"
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <Select
          aria-label={t("labels.year")}
          value={String(year)}
          onChange={(event) => setYear(Number(event.target.value))}
          className="h-10 w-24"
        >
          {years.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
