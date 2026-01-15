import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { api, parseInvokeError } from "../lib/api";
import { formatCHF, formatPercent } from "../lib/format";
import { useI18n } from "../lib/i18n";
import type { YearCharts, YearKpis } from "../lib/types";
import { useAppStore } from "../state/appStore";
import { useToastStore } from "../state/toastStore";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { ChartTooltip } from "../components/ui/ChartTooltip";
import { KpiCard } from "../components/ui/KpiCard";

export function YearPage() {
  const { year } = useAppStore();
  const { t, locale, monthNamesShort } = useI18n();
  const addToast = useToastStore((state) => state.addToast);
  const [kpis, setKpis] = useState<YearKpis | null>(null);
  const [charts, setCharts] = useState<YearCharts | null>(null);

  const paymentData = useMemo(
    () =>
      charts?.payments.map((item, index) => ({
        ...item,
        fill: [
          "var(--color-app-accent)",
          "var(--color-app-positive)",
          "var(--color-app-warning)",
          "var(--color-app-danger)",
        ][index % 4],
      })) ?? [],
    [charts]
  );

  const reload = useCallback(() => {
    Promise.all([api.getYearKpis(year), api.getYearCharts(year)])
      .then(([kpiData, chartData]) => {
        setKpis(kpiData);
        setCharts(chartData);
      })
      .catch((error) => {
        addToast({
          title: t("labels.yearLoadFailed"),
          description: String(error),
          variant: "danger",
        });
      });
  }, [addToast, t, year]);

  useEffect(() => {
    reload();
  }, [reload]);

  const formatTooltipValue = (value: number) => formatCHF(value, locale);


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">{t("labels.yearTitle")}</h1>
          <p className="page-subtitle">{t("labels.yearSubtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                const savePath = await api.pickSavePath(`export_${year}.xlsx`);
                if (!savePath) return;
                const path = await api.exportExcel({ year, output_path: savePath });
                addToast({ title: t("labels.exportYearDone"), description: path, variant: "success" });
              } catch (error) {
                const parsed = parseInvokeError(error);
                addToast({ title: t("labels.exportFailed"), description: parsed.message, variant: "danger" });
              }
            }}
          >
            {t("labels.exportYear", { year })}
          </Button>
          <Button variant="secondary" onClick={reload}>
            {t("actions.update")}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <KpiCard label={t("labels.kpiIncome")} value={formatCHF(kpis?.income_total ?? 0, locale)} accent="positive" />
        <KpiCard label="BAR" value={formatCHF(kpis?.income_bar ?? 0, locale)} />
        <KpiCard label="TWINT" value={formatCHF(kpis?.income_twint ?? 0, locale)} />
        <KpiCard label={t("labels.kpiExpense")} value={formatCHF(kpis?.expense_total ?? 0, locale)} accent="warning" />
        <KpiCard
          label={t("labels.kpiResult")}
          value={formatCHF(kpis?.result ?? 0, locale)}
          accent={(kpis?.result ?? 0) >= 0 ? "positive" : "danger"}
        />
        <KpiCard label={t("labels.kpiMargin")} value={formatPercent(kpis?.margin ?? 0, locale)} />
        <KpiCard label={t("labels.kpiMwstIncome")} value={formatCHF(kpis?.mwst_income ?? 0, locale)} />
        <KpiCard label={t("labels.kpiMwstExpense")} value={formatCHF(kpis?.mwst_expense ?? 0, locale)} />
        <KpiCard label={t("labels.kpiMwstDue")} value={formatCHF(kpis?.mwst_due ?? 0, locale)} accent="warning" />
        <KpiCard
          label={t("labels.kpiMissingReceipts")}
          value={`${kpis?.missing_receipts_count ?? 0}`}
          hint={formatCHF(kpis?.missing_receipts_sum ?? 0, locale)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("labels.yearTrend")}</CardTitle>
          </CardHeader>
          <CardBody className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={charts?.monthly ?? []}>
                <CartesianGrid strokeDasharray="4 4" stroke="var(--color-app-muted)" />
                <XAxis
                  dataKey="month"
                  tickFormatter={(value) => monthNamesShort[value - 1]}
                  tick={{ fill: "var(--color-app-neutral)" }}
                  axisLine={{ stroke: "var(--color-app-border)" }}
                  tickLine={{ stroke: "var(--color-app-border)" }}
                />
                <YAxis
                  tickFormatter={(value) => formatCHF(Number(value), locale)}
                  tick={{ fill: "var(--color-app-neutral)" }}
                  axisLine={{ stroke: "var(--color-app-border)" }}
                  tickLine={{ stroke: "var(--color-app-border)" }}
                />
                <Tooltip content={<ChartTooltip valueFormatter={formatTooltipValue} />} />
                <Legend formatter={(value) => <span style={{ color: "var(--color-app-neutral)" }}>{value}</span>} />
                <Bar dataKey="income" fill="var(--color-app-positive)" name={t("labels.kpiIncome")} radius={[4, 4, 0, 0]} />
                <Bar dataKey="expense" fill="var(--color-app-warning)" name={t("labels.kpiExpense")} radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="result" stroke="var(--color-app-accent)" strokeWidth={2} name={t("labels.kpiResult")} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("labels.topCategories")}</CardTitle>
          </CardHeader>
          <CardBody className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={charts?.categories ?? []} layout="vertical">
                <CartesianGrid strokeDasharray="4 4" stroke="var(--color-app-muted)" />
                <XAxis
                  type="number"
                  tickFormatter={(value) => formatCHF(Number(value), locale)}
                  tick={{ fill: "var(--color-app-neutral)" }}
                  axisLine={{ stroke: "var(--color-app-border)" }}
                  tickLine={{ stroke: "var(--color-app-border)" }}
                />
                <YAxis
                  type="category"
                  dataKey="category"
                  width={120}
                  tick={{ fill: "var(--color-app-neutral)" }}
                  axisLine={{ stroke: "var(--color-app-border)" }}
                  tickLine={{ stroke: "var(--color-app-border)" }}
                />
                <Tooltip content={<ChartTooltip valueFormatter={formatTooltipValue} />} />
                <Bar dataKey="amount" fill="var(--color-app-accent)" radius={[6, 6, 6, 6]} />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("labels.paymentTypesYear")}</CardTitle>
          </CardHeader>
          <CardBody className="flex h-80 flex-col gap-3">
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={paymentData} dataKey="amount" nameKey="payment_method" innerRadius={50} outerRadius={90} paddingAngle={3}>
                    {paymentData.map((entry) => (
                      <Cell key={entry.payment_method} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip valueFormatter={formatTooltipValue} />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1 text-xs text-app-neutral">
              {paymentData.map((item) => (
                <div key={item.payment_method} className="flex items-center justify-between">
                  <span>{item.payment_method || "-"}</span>
                  <span className="font-medium text-app-primary">{formatCHF(item.amount, locale)}</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

    </div>
  );
}
