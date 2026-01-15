import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { api } from "../../lib/api";
import { formatCHF, formatDate } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import type { TransactionListItem } from "../../lib/types";
import { useAppStore } from "../../state/appStore";

const navItems = [
  { labelKey: "nav.dashboard", to: "/" },
  { labelKey: "nav.income", to: "/income" },
  { labelKey: "nav.expense", to: "/expense" },
  { labelKey: "nav.month", to: "/month" },
  { labelKey: "nav.year", to: "/year" },
  { labelKey: "nav.receipts", to: "/receipts" },
  { labelKey: "nav.categories", to: "/categories" },
  { labelKey: "nav.export", to: "/export" },
  { labelKey: "nav.audit", to: "/audit" },
  { labelKey: "nav.settings", to: "/settings" },
];

const typeBadge: Record<string, "success" | "warning" | "default"> = {
  INCOME: "success",
  EXPENSE: "warning",
  CORRECTION: "default",
};

export function TopBar() {
  const {
    setYear,
    setMonth,
    settings,
    globalSearch,
    setGlobalSearch,
    toggleSidebar,
    toggleTheme,
    theme,
  } = useAppStore();
  const { t, locale, monthNamesShort } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();

  const typeLabels = useMemo(
    () => ({
      INCOME: t("labels.income"),
      EXPENSE: t("labels.expense"),
      CORRECTION: t("labels.correction"),
    }),
    [t]
  );

  const [results, setResults] = useState<TransactionListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const searchTimer = useRef<number | null>(null);
  const searchToken = useRef(0);

  const runSearch = useCallback((value: string) => {
    const query = value.trim();
    if (searchTimer.current) {
      window.clearTimeout(searchTimer.current);
    }
    if (query.length < 2) {
      searchToken.current += 1;
      setResults([]);
      setLoading(false);
      return;
    }
    const token = ++searchToken.current;
    searchTimer.current = window.setTimeout(() => {
      setLoading(true);
      api
        .searchTransactions(query, 12)
        .then((items) => {
          if (searchToken.current !== token) return;
          setResults(items);
        })
        .catch(() => {
          if (searchToken.current !== token) return;
          setResults([]);
        })
        .finally(() => {
          if (searchToken.current !== token) return;
          setLoading(false);
        });
    }, 250);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    runSearch(globalSearch);
    return () => {
      if (searchTimer.current) {
        window.clearTimeout(searchTimer.current);
      }
    };
  }, [globalSearch, runSearch]);

  const showResults = globalSearch.trim().length >= 2;

  return (
    <header className="z-30 border-b border-app-border bg-app-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-screen-2xl flex-col gap-2 px-4 py-2 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" onClick={toggleSidebar}>
            {t("labels.menu")}
          </Button>
          <div className="relative min-w-[260px] flex-1" data-tour="search">
            <Input
              className="h-10"
              placeholder={t("labels.searchPlaceholder")}
              value={globalSearch}
              onChange={(event) => {
                const value = event.target.value;
                setGlobalSearch(value);
                runSearch(value);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                const query = globalSearch.trim();
                if (query.length < 2) return;
                navigate(`/search?q=${encodeURIComponent(query)}`);
              }}
              aria-label={t("labels.search")}
            />
            {showResults && (
              <div className="absolute left-0 right-0 top-full mt-2 rounded-2xl border border-app-border bg-app-card shadow-xl">
                <div className="px-4 py-2 text-xs uppercase tracking-wide text-app-neutral">
                  {t("labels.quickResults")}
                </div>
                {loading && (
                  <div className="px-4 py-3 text-sm text-app-neutral">{t("labels.searching")}</div>
                )}
                {!loading && results.length === 0 && (
                  <div className="px-4 py-3 text-sm text-app-neutral">{t("labels.noResults")}</div>
                )}
                {!loading && results.length > 0 && (
                  <div className="max-h-80 overflow-auto">
                    {results.map((item) => {
                      const label = typeLabels[item.type] ?? item.type;
                      const badge = typeBadge[item.type] ?? "default";
                      const meta = item.category_name ?? item.payment_method ?? "-";
                      return (
                        <button
                          key={`${item.public_id}-${item.date}`}
                          className="w-full border-t border-app-border/60 px-4 py-3 text-left transition hover:bg-app-surface"
                          onClick={() => {
                            setYear(item.year);
                            setMonth(item.month);
                            setGlobalSearch(item.public_id);
                            setLoading(true);
                            navigate("/month");
                          }}
                          type="button"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-app-primary">ID {item.public_id}</div>
                            <Badge variant={badge}>{label}</Badge>
                          </div>
                          <div className="mt-1 text-xs text-app-neutral">
                            {formatDate(item.date, locale)} - {meta} - {formatCHF(item.amount_chf, locale)} -{" "}
                            {monthNamesShort[item.month - 1]} {item.year}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {settings && <Badge>{t("labels.taxShort")}: {settings.mwst_mode}</Badge>}
            <Button variant="ghost" size="sm" onClick={toggleTheme}>
              {theme === "dark" ? t("labels.themeLight") : t("labels.themeDark")}
            </Button>
          </div>
        </div>

        <div className="w-full md:hidden">
          <Select label={t("labels.navigation")} value={location.pathname} onChange={(event) => navigate(event.target.value)}>
            {navItems.map((item) => (
              <option key={item.to} value={item.to}>
                {t(item.labelKey)}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </header>
  );
}
