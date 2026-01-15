import { useMemo, useState } from "react";
import Papa from "papaparse";

import { api, parseInvokeError } from "../../lib/api";
import { parseDecimalInput } from "../../lib/parse";
import { useI18n } from "../../lib/i18n";
import type { TwintImportRow, TwintImportSummary } from "../../lib/types";
import { useToastStore } from "../../state/toastStore";
import { Button } from "../ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { Select } from "../ui/Select";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "../ui/Table";

type Step = "select" | "map" | "review" | "done";

type Mapping = {
  date: string;
  amount: string;
  fee: string;
  reference: string;
  description: string;
};

const emptyMapping: Mapping = {
  date: "",
  amount: "",
  fee: "",
  reference: "",
  description: "",
};

export function TwintImportWizard() {
  const { t } = useI18n();
  const addToast = useToastStore((state) => state.addToast);
  const [step, setStep] = useState<Step>("select");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Mapping>(emptyMapping);
  const [incomeMwstRate, setIncomeMwstRate] = useState("8.1");
  const [feeMwstRate, setFeeMwstRate] = useState("0");
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [summary, setSummary] = useState<TwintImportSummary | null>(null);
  const [importing, setImporting] = useState(false);

  const mwstOptions = useMemo(
    () => [
      { value: "0", label: `0% (${t("labels.none")})` },
      { value: "2.6", label: `2.6% ${t("labels.reduced")}` },
      { value: "3.8", label: `3.8% ${t("labels.accommodation")}` },
      { value: "7.7", label: `7.7% ${t("labels.oldRate")}` },
      { value: "8.1", label: `8.1% ${t("labels.standard")}` },
    ],
    [t]
  );

  const previewRows = rows.slice(0, 5);
  const hasMapping = mapping.date && mapping.amount;

  const loadFile = async () => {
    try {
      const selected = await api.pickImportFile();
      if (!selected) return;
      const content = await api.readTextFile(selected);
      const parsed = Papa.parse<Record<string, string>>(content, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (value: string) => value.trim(),
      });
      if (parsed.errors.length > 0) {
        throw new Error(parsed.errors[0]?.message ?? "CSV Fehler");
      }
      const nextRows = parsed.data.filter((row) => Object.values(row).some((value) => String(value ?? "").trim().length > 0));
      const nextHeaders = parsed.meta.fields ?? [];
      setFilePath(selected);
      setHeaders(nextHeaders);
      setRows(nextRows);
      setMapping(guessMapping(nextHeaders));
      setStep("map");
    } catch (error) {
      const parsed = parseInvokeError(error);
      addToast({ title: t("labels.importFailed"), description: parsed.message, variant: "danger" });
    }
  };

  const buildRows = (): TwintImportRow[] => {
    const result: TwintImportRow[] = [];
    rows.forEach((row) => {
      const dateValue = normalizeDate(row[mapping.date]);
      const amountValue = parseDecimalInput(row[mapping.amount]);
      if (!dateValue || !amountValue) return;
      const feeValue = mapping.fee ? parseDecimalInput(row[mapping.fee]) ?? undefined : undefined;
      const referenceValue = mapping.reference ? String(row[mapping.reference] ?? "").trim() || undefined : undefined;
      const descriptionValue = mapping.description ? String(row[mapping.description] ?? "").trim() || undefined : undefined;
      result.push({
        date: dateValue,
        amount_chf: amountValue,
        fee_chf: feeValue,
        reference: referenceValue,
        description: descriptionValue,
      });
    });
    return result;
  };

  const startImport = async () => {
    const preparedRows = buildRows();
    if (preparedRows.length === 0) {
      addToast({ title: t("labels.importEmpty"), variant: "danger" });
      return;
    }
    const incomeRate = parseDecimalInput(incomeMwstRate) ?? 0;
    const feeRate = parseDecimalInput(feeMwstRate) ?? 0;
    setImporting(true);
    try {
      const result = await api.importTwint({
        rows: preparedRows,
        income_mwst_rate: incomeRate,
        fee_mwst_rate: feeRate,
        skip_duplicates: skipDuplicates,
      });
      setSummary(result);
      setStep("done");
      addToast({ title: t("labels.importDone"), variant: "success" });
    } catch (error) {
      const parsed = parseInvokeError(error);
      addToast({ title: t("labels.importFailed"), description: parsed.message, variant: "danger" });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("labels.twintImportTitle")}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        {step === "select" && (
          <div className="space-y-3">
            <p className="text-sm text-app-neutral">{t("labels.twintImportIntro")}</p>
            <Button onClick={loadFile}>{t("labels.importPickFile")}</Button>
          </div>
        )}

        {step === "map" && (
          <div className="space-y-4">
            <div className="text-sm text-app-neutral">{t("labels.importFileSelected")}: {filePath}</div>
            <div className="grid gap-3 md:grid-cols-2">
              <Select label={t("labels.importMapDate")} value={mapping.date} onChange={(event) => setMapping({ ...mapping, date: event.target.value })}>
                <option value="">{t("labels.selectPlaceholder")}</option>
                {headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </Select>
              <Select label={t("labels.importMapAmount")} value={mapping.amount} onChange={(event) => setMapping({ ...mapping, amount: event.target.value })}>
                <option value="">{t("labels.selectPlaceholder")}</option>
                {headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </Select>
              <Select label={t("labels.importMapFee")} value={mapping.fee} onChange={(event) => setMapping({ ...mapping, fee: event.target.value })}>
                <option value="">{t("labels.optional")}</option>
                {headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </Select>
              <Select label={t("labels.importMapReference")} value={mapping.reference} onChange={(event) => setMapping({ ...mapping, reference: event.target.value })}>
                <option value="">{t("labels.optional")}</option>
                {headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </Select>
              <Select label={t("labels.importMapDescription")} value={mapping.description} onChange={(event) => setMapping({ ...mapping, description: event.target.value })}>
                <option value="">{t("labels.optional")}</option>
                {headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </Select>
            </div>
            <div className="rounded-xl border border-app-border bg-app-surface px-4 py-3">
              <div className="text-xs text-app-neutral">
                {t("labels.importPreview")} ({previewRows.length}/{rows.length})
              </div>
              <div className="mt-3 overflow-auto">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>{t("labels.date")}</TableHeaderCell>
                      <TableHeaderCell>{t("labels.amount")}</TableHeaderCell>
                      <TableHeaderCell>{t("labels.importMapFee")}</TableHeaderCell>
                      <TableHeaderCell>{t("labels.importMapReference")}</TableHeaderCell>
                      <TableHeaderCell>{t("labels.importMapDescription")}</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <tbody>
                    {previewRows.map((row, index) => (
                      <TableRow key={`${index}-${row[mapping.date] ?? ""}`}>
                        <TableCell>{mapping.date ? row[mapping.date] : "-"}</TableCell>
                        <TableCell>{mapping.amount ? row[mapping.amount] : "-"}</TableCell>
                        <TableCell>{mapping.fee ? row[mapping.fee] : "-"}</TableCell>
                        <TableCell>{mapping.reference ? row[mapping.reference] : "-"}</TableCell>
                        <TableCell>{mapping.description ? row[mapping.description] : "-"}</TableCell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="secondary" onClick={() => setStep("select")}>
                {t("actions.previous")}
              </Button>
              <Button onClick={() => setStep("review")} disabled={!hasMapping}>
                {t("actions.next")}
              </Button>
            </div>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Select label={t("labels.importMwstIncome")} value={incomeMwstRate} onChange={(event) => setIncomeMwstRate(event.target.value)}>
                {mwstOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <Select label={t("labels.importMwstFee")} value={feeMwstRate} onChange={(event) => setFeeMwstRate(event.target.value)}>
                {mwstOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <div className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={skipDuplicates}
                  onChange={(event) => setSkipDuplicates(event.target.checked)}
                />
                <span>{t("labels.importSkipDuplicates")}</span>
              </div>
            </div>
            <div className="rounded-xl border border-app-border bg-app-surface px-4 py-3 text-xs text-app-neutral">
              {t("labels.importReady", { count: buildRows().length })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="secondary" onClick={() => setStep("map")}>
                {t("actions.previous")}
              </Button>
              <Button onClick={startImport} disabled={importing}>
                {importing ? t("labels.importRunning") : t("labels.importStart")}
              </Button>
            </div>
          </div>
        )}

        {step === "done" && summary && (
          <div className="space-y-3">
            <div className="text-sm text-app-neutral">{t("labels.importSummary")}</div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-app-border bg-app-surface px-4 py-3 text-sm">
                <div className="text-xs text-app-neutral">{t("labels.importIncomeCount")}</div>
                <div className="text-base font-semibold text-app-primary">{summary.income_created}</div>
              </div>
              <div className="rounded-xl border border-app-border bg-app-surface px-4 py-3 text-sm">
                <div className="text-xs text-app-neutral">{t("labels.importFeeCount")}</div>
                <div className="text-base font-semibold text-app-primary">{summary.fee_created}</div>
              </div>
              <div className="rounded-xl border border-app-border bg-app-surface px-4 py-3 text-sm">
                <div className="text-xs text-app-neutral">{t("labels.importSkipCount")}</div>
                <div className="text-base font-semibold text-app-primary">{summary.skipped_duplicates}</div>
              </div>
            </div>
            <Button variant="secondary" onClick={() => setStep("select")}>
              {t("labels.importStartOver")}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function guessMapping(headers: string[]): Mapping {
  const next = { ...emptyMapping };
  headers.forEach((header) => {
    const lower = header.toLowerCase();
    if (!next.date && /datum|date/.test(lower)) next.date = header;
    if (!next.amount && /betrag|amount|total|sum/.test(lower)) next.amount = header;
    if (!next.fee && /fee|gebuehr|commission|charge/.test(lower)) next.fee = header;
    if (!next.reference && /referenz|reference|transaktion|transaction|id/.test(lower)) next.reference = header;
    if (!next.description && /beschreibung|description|note|text/.test(lower)) next.description = header;
  });
  return next;
}

function normalizeDate(value: string | undefined): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  const isoMatch = raw.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
  }
  const match = raw.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/);
  if (!match) return null;
  let year = Number(match[3]);
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}
