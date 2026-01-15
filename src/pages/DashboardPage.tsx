import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../lib/api";
import { formatCHF, formatPercent } from "../lib/format";
import { useI18n } from "../lib/i18n";
import type { MonthKpis, YearKpis } from "../lib/types";
import { useToastStore } from "../state/toastStore";
import { useAppStore } from "../state/appStore";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { KpiCard } from "../components/ui/KpiCard";

export function DashboardPage() {
  const { year, month } = useAppStore();
  const { t, locale } = useI18n();
  const addToast = useToastStore((state) => state.addToast);
  const [monthKpis, setMonthKpis] = useState<MonthKpis | null>(null);
  const [yearKpis, setYearKpis] = useState<YearKpis | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api.getMonthKpis(year, month), api.getYearKpis(year)])
      .then(([monthData, yearData]) => {
        if (!active) return;
        setMonthKpis(monthData);
        setYearKpis(yearData);
      })
      .catch((error) => {
        addToast({
          title: t("labels.dashboardLoadFailed"),
          description: String(error),
          variant: "danger",
        });
      });
    return () => {
      active = false;
    };
  }, [year, month, addToast, t]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">{t("app.title")}</h1>
          <p className="page-subtitle">{t("app.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Link to="/income">
            <Button>{t("labels.newIncome")}</Button>
          </Link>
          <Link to="/expense">
            <Button variant="secondary">{t("labels.newExpense")}</Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <KpiCard
          label={t("labels.kpiIncomeMonth")}
          value={formatCHF(monthKpis?.income_total ?? 0, locale)}
          accent="positive"
        />
        <KpiCard
          label={t("labels.kpiResultMonth")}
          value={formatCHF(monthKpis?.result ?? 0, locale)}
          accent={(monthKpis?.result ?? 0) >= 0 ? "positive" : "danger"}
        />
        <KpiCard
          label={t("labels.kpiMarginMonth")}
          value={formatPercent(monthKpis?.margin ?? 0, locale)}
        />
        <KpiCard
          label={t("labels.kpiIncomeYear")}
          value={formatCHF(yearKpis?.income_total ?? 0, locale)}
        />
        <KpiCard
          label={t("labels.kpiResultYear")}
          value={formatCHF(yearKpis?.result ?? 0, locale)}
          accent={(yearKpis?.result ?? 0) >= 0 ? "positive" : "danger"}
        />
        <KpiCard label={t("labels.kpiMwstDue")} value={formatCHF(yearKpis?.mwst_due ?? 0, locale)} accent="warning" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("labels.qualityCheck")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2 page-subtitle">
          <div className="flex items-center justify-between">
            <span>{t("labels.kpiMissingReceiptsMonth")}</span>
            <span className="font-medium text-app-primary">{monthKpis?.missing_receipts_count ?? 0}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>{t("labels.kpiMissingReceiptsSum")}</span>
            <span className="font-medium text-app-primary">
              {formatCHF(monthKpis?.missing_receipts_sum ?? 0, locale)}
            </span>
          </div>
          <div className="text-xs text-app-neutral">{t("labels.kpiMissingReceiptsHint")}</div>
        </CardBody>
      </Card>
    </div>
  );
}
