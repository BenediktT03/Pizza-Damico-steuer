import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import { formatCHF, formatDate, formatIsoDate, formatPercent } from "../lib/format";
import { useI18n } from "../lib/i18n";
import type { MonthCharts, MonthKpis, Paginated, TransactionListItem } from "../lib/types";
import { useAppStore } from "../state/appStore";
import { useToastStore } from "../state/toastStore";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { ChartTooltip } from "../components/ui/ChartTooltip";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { MonthToolbar } from "../components/layout/MonthToolbar";
import { KpiCard } from "../components/ui/KpiCard";
import { Modal } from "../components/ui/Modal";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "../components/ui/Table";

const colors = [
  "var(--color-app-accent)",
  "var(--color-app-positive)",
  "var(--color-app-warning)",
  "var(--color-app-danger)",
  "#1D4ED8",
  "#334155",
];

export function MonthPage() {
  const { year, month, globalSearch } = useAppStore();
  const { t, locale } = useI18n();
  const addToast = useToastStore((state) => state.addToast);
  const [kpis, setKpis] = useState<MonthKpis | null>(null);
  const [charts, setCharts] = useState<MonthCharts | null>(null);
  const [incomeData, setIncomeData] = useState<Paginated<TransactionListItem> | null>(null);
  const [expenseData, setExpenseData] = useState<Paginated<TransactionListItem> | null>(null);
  const [selectedTx, setSelectedTx] = useState<TransactionListItem | null>(null);
  const [confirmStorno, setConfirmStorno] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const reload = useCallback((search: string) => {
    Promise.all([
      api.getMonthKpis(year, month),
      api.getMonthCharts(year, month),
      api.listTransactions({
        year,
        month,
        tx_type: "INCOME",
        page: 1,
        page_size: 200,
        search,
      }),
      api.listTransactions({
        year,
        month,
        tx_type: "EXPENSE",
        page: 1,
        page_size: 200,
        search,
      }),
    ])
      .then(([kpiData, chartData, incomeList, expenseList]) => {
        setKpis(kpiData);
        setCharts(chartData);
        setIncomeData(incomeList);
        setExpenseData(expenseList);
      })
      .catch((error) => {
        addToast({
          title: t("labels.monthLoadFailed"),
          description: String(error),
          variant: "danger",
        });
      });
  }, [addToast, month, t, year]);

  useEffect(() => {
    const timeout = setTimeout(() => reload(globalSearch), 250);
    return () => clearTimeout(timeout);
  }, [globalSearch, reload]);

  const dailyData = useMemo(
    () =>
      (charts?.daily ?? []).map((point) => ({
        ...point,
        result: point.income - point.expense,
      })),
    [charts]
  );

  const paymentData = useMemo(
    () =>
      charts?.payments.map((item, index) => ({
        ...item,
        fill: colors[index % colors.length],
      })) ?? [],
    [charts]
  );

  const paymentTotal = useMemo(() => paymentData.reduce((sum, item) => sum + item.amount, 0), [paymentData]);
  const hasSearch = globalSearch.trim().length > 0;
  const formatTooltipValue = (value: number) => formatCHF(value, locale);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">{t("labels.monthTitle")}</h1>
          <p className="page-subtitle">{t("labels.monthSubtitle")}</p>
          {hasSearch && <div className="mt-2 text-xs text-app-neutral">{t("labels.filterActive", { query: globalSearch })}</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/income">
            <Button>{t("labels.newIncome")}</Button>
          </Link>
          <Link to="/expense">
            <Button variant="secondary">{t("labels.newExpense")}</Button>
          </Link>
          <Button variant="secondary" onClick={() => reload(globalSearch)}>
            {t("actions.update")}
          </Button>
        </div>
      </div>
      <MonthToolbar />

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

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("labels.monthTrend")}</CardTitle>
          </CardHeader>
          <CardBody className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyData}>
                <defs>
                  <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-app-positive)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--color-app-positive)" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-app-warning)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--color-app-warning)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" stroke="var(--color-app-muted)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value) => value.slice(8)}
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
                <Area type="monotone" dataKey="income" stroke="var(--color-app-positive)" fill="url(#incomeGradient)" name={t("labels.kpiIncome")} />
                <Area type="monotone" dataKey="expense" stroke="var(--color-app-warning)" fill="url(#expenseGradient)" name={t("labels.kpiExpense")} />
                <Line type="monotone" dataKey="result" stroke="var(--color-app-accent)" strokeWidth={2} dot={false} name={t("labels.kpiResult")} />
              </AreaChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("labels.paymentTypes")}</CardTitle>
          </CardHeader>
          <CardBody className="flex h-80 flex-col gap-3">
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={paymentData}
                    dataKey="amount"
                    nameKey="payment_method"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={3}
                    labelLine={false}
                    label={({ percent, x, y }) => (
                      <text
                        x={x}
                        y={y}
                        fill="var(--color-app-neutral)"
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={12}
                      >
                        {`${((percent ?? 0) * 100).toFixed(0)}%`}
                      </text>
                    )}
                  >
                    {paymentData.map((entry, index) => (
                      <Cell key={entry.payment_method} fill={colors[index % colors.length]} />
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
                  <span className="font-medium text-app-primary">
                    {formatCHF(item.amount, locale)}
                    {paymentTotal > 0 && (
                      <span className="ml-2 text-xs text-app-neutral">
                        {formatPercent(item.amount / paymentTotal, locale)}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("labels.topExpenseCategories")}</CardTitle>
        </CardHeader>
          <CardBody className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={charts?.categories ?? []} layout="vertical" margin={{ left: 16 }}>
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("labels.income")}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell className="sticky left-0 bg-app-surface">{t("labels.tableId")}</TableHeaderCell>
                  <TableHeaderCell>{t("labels.tableDate")}</TableHeaderCell>
                  <TableHeaderCell>{t("labels.tablePayment")}</TableHeaderCell>
                  <TableHeaderCell>{t("labels.tableAmount")}</TableHeaderCell>
                </TableRow>
              </TableHead>
              <tbody>
                {(incomeData?.items.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-sm text-app-neutral">
                      {t("labels.noIncomePeriod")}
                    </TableCell>
                  </TableRow>
                )}
                {incomeData?.items.map((tx) => (
                  <TableRow key={tx.id} className="cursor-pointer hover:bg-app-surface" onClick={() => setSelectedTx(tx)}>
                    <TableCell className="sticky left-0 bg-app-card">{tx.public_id}</TableCell>
                    <TableCell>{formatDate(tx.date, locale)}</TableCell>
                    <TableCell>{tx.payment_method}</TableCell>
                    <TableCell className="font-medium text-app-primary">{formatCHF(tx.amount_chf, locale)}</TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("labels.expense")}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell className="sticky left-0 bg-app-surface">{t("labels.tableId")}</TableHeaderCell>
                  <TableHeaderCell>{t("labels.tableDate")}</TableHeaderCell>
                  <TableHeaderCell>{t("labels.tableCategory")}</TableHeaderCell>
                  <TableHeaderCell>{t("labels.tableAmount")}</TableHeaderCell>
                </TableRow>
              </TableHead>
              <tbody>
                {(expenseData?.items.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-sm text-app-neutral">
                      {t("labels.noExpensePeriod")}
                    </TableCell>
                  </TableRow>
                )}
                {expenseData?.items.map((tx) => (
                  <TableRow key={tx.id} className="cursor-pointer hover:bg-app-surface" onClick={() => setSelectedTx(tx)}>
                    <TableCell className="sticky left-0 bg-app-card">{tx.public_id}</TableCell>
                    <TableCell>{formatDate(tx.date, locale)}</TableCell>
                    <TableCell>{tx.category_name ?? "-"}</TableCell>
                    <TableCell className="font-medium text-app-primary">{formatCHF(tx.amount_chf, locale)}</TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      </div>

      <Modal open={!!selectedTx} onClose={() => setSelectedTx(null)} title={t("labels.transactionDetails")}>
        {selectedTx && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-app-neutral">ID</span>
              <span className="font-medium">{selectedTx.public_id}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-app-neutral">{t("labels.date")}</span>
              <span className="font-medium">{formatDate(selectedTx.date, locale)}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-app-neutral">{t("labels.type")}</span>
              <span className="font-medium">{selectedTx.type}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-app-neutral">{t("labels.amount")}</span>
              <span className="font-medium">{formatCHF(selectedTx.amount_chf, locale)}</span>
            </div>
            {selectedTx.category_name && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-app-neutral">{t("labels.category")}</span>
                <span className="font-medium">{selectedTx.category_name}</span>
              </div>
            )}
            {selectedTx.payment_method && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-app-neutral">{t("labels.payment")}</span>
                <span className="font-medium">{selectedTx.payment_method}</span>
              </div>
            )}
            {selectedTx.note && <div className="text-xs text-app-neutral">{selectedTx.note}</div>}
            <div className="flex flex-wrap gap-2">
              {selectedTx.is_stornoed && <Badge variant="warning">{t("labels.stornoed")}</Badge>}
              {selectedTx.ref_public_id && <Badge>{t("labels.reference")} {selectedTx.ref_public_id}</Badge>}
            </div>
            {selectedTx.receipt_path && (
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    await api.openReceipt(selectedTx.receipt_path ?? "");
                  } catch (error) {
                    const parsed = parseInvokeError(error);
                    addToast({
                      title: t("labels.receiptOpenFailed"),
                      description: parsed.message,
                      variant: "danger",
                    });
                  }
                }}
              >
                {t("labels.openReceipt")}
              </Button>
            )}
            {selectedTx.amount_chf > 0 && !selectedTx.is_stornoed && (
              <Button variant="danger" onClick={() => setConfirmStorno(true)}>
                {t("labels.storno")}
              </Button>
            )}
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              {t("labels.deleteTx")}
            </Button>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmStorno}
        title={t("labels.stornoCreate")}
        description={t("labels.stornoConfirm")}
        confirmLabel={t("labels.stornoConfirmAction")}
        onConfirm={async () => {
          if (!selectedTx) return;
          try {
            await api.createStorno({
              public_id: selectedTx.public_id,
              date: formatIsoDate(new Date()),
              reason: "Korrektur",
            });
            addToast({ title: t("labels.stornoCreated"), variant: "success" });
            setConfirmStorno(false);
            setSelectedTx(null);
            reload(globalSearch);
          } catch (error) {
            const parsed = parseInvokeError(error);
            addToast({
              title: t("labels.stornoFailed"),
              description: parsed.message,
              variant: "danger",
            });
          }
        }}
        onCancel={() => setConfirmStorno(false)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title={t("labels.deleteTxConfirmTitle")}
        description={t("labels.deleteTxConfirmBody")}
        confirmLabel={t("labels.deleteTxConfirmAction")}
        onConfirm={async () => {
          if (!selectedTx) return;
          try {
            await api.deleteTransaction(selectedTx.public_id);
            addToast({ title: t("labels.deleteTxDone"), variant: "success" });
            setConfirmDelete(false);
            setSelectedTx(null);
            reload(globalSearch);
          } catch (error) {
            const parsed = parseInvokeError(error);
            addToast({ title: t("labels.deleteTxFailed"), description: parsed.message, variant: "danger" });
          }
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
