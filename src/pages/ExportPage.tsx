import { useEffect, useState } from "react";

import { api, parseInvokeError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useAppStore } from "../state/appStore";
import { useToastStore } from "../state/toastStore";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Select } from "../components/ui/Select";
import { TwintImportWizard } from "../components/import/TwintImportWizard";

export function ExportPage() {
  const { year, month } = useAppStore();
  const { t, monthNamesLong } = useI18n();
  const addToast = useToastStore((state) => state.addToast);
  const [includeReceipts, setIncludeReceipts] = useState(true);
  const [restorePath, setRestorePath] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [rangeFrom, setRangeFrom] = useState(month);
  const [rangeTo, setRangeTo] = useState(month);

  useEffect(() => {
    setRangeFrom(month);
    setRangeTo(month);
  }, [month]);

  const exportYear = async () => {
    try {
      const savePath = await api.pickSavePath(`export_${year}.xlsx`);
      if (!savePath) return;
      const path = await api.exportExcel({ year, output_path: savePath });
      addToast({ title: t("labels.exportYearDone"), description: path, variant: "success" });
    } catch (error) {
      const parsed = parseInvokeError(error);
      addToast({ title: t("labels.exportFailed"), description: parsed.message, variant: "danger" });
    }
  };

  const exportMonth = async () => {
    try {
      const monthLabel = String(month).padStart(2, "0");
      const savePath = await api.pickSavePath(`export_${year}_${monthLabel}.xlsx`);
      if (!savePath) return;
      const path = await api.exportExcel({ year, month, output_path: savePath });
      addToast({ title: t("labels.exportMonthDone"), description: path, variant: "success" });
    } catch (error) {
      const parsed = parseInvokeError(error);
      addToast({ title: t("labels.exportFailed"), description: parsed.message, variant: "danger" });
    }
  };

  const exportCsv = async () => {
    try {
      const savePath = await api.pickSavePath(`export_${year}.csv`);
      if (!savePath) return;
      const path = await api.exportCsv(year, savePath);
      addToast({ title: t("labels.exportCsvDone"), description: path, variant: "success" });
    } catch (error) {
      const parsed = parseInvokeError(error);
      addToast({ title: t("labels.exportFailed"), description: parsed.message, variant: "danger" });
    }
  };

  const exportRange = async () => {
    if (rangeFrom > rangeTo) {
      addToast({ title: t("labels.exportRangeInvalid"), variant: "danger" });
      return;
    }
    try {
      const fromLabel = String(rangeFrom).padStart(2, "0");
      const toLabel = String(rangeTo).padStart(2, "0");
      const savePath = await api.pickSavePath(`export_${year}_${fromLabel}-${toLabel}.xlsx`);
      if (!savePath) return;
      const path = await api.exportExcel({ year, month_from: rangeFrom, month_to: rangeTo, output_path: savePath });
      addToast({ title: t("labels.exportRangeDone"), description: path, variant: "success" });
    } catch (error) {
      const parsed = parseInvokeError(error);
      addToast({ title: t("labels.exportFailed"), description: parsed.message, variant: "danger" });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("labels.export")} & {t("labels.backup")}</h1>
        <p className="page-subtitle">{t("labels.exportSubtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("labels.excelExport")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button onClick={exportMonth}>{t("labels.exportMonth", { month: monthNamesLong[month - 1] })}</Button>
            <Button variant="secondary" onClick={exportYear}>
              {t("labels.exportYear", { year })}
            </Button>
            <Button variant="secondary" onClick={exportCsv}>
              {t("labels.exportCsvYear", { year })}
            </Button>
          </div>
          <div className="grid items-end gap-3 md:grid-cols-[1fr_1fr_auto]">
            <Select
              label={t("labels.exportRangeFrom")}
              value={String(rangeFrom)}
              onChange={(event) => setRangeFrom(Number(event.target.value))}
            >
              {monthNamesLong.map((label, index) => (
                <option key={label} value={index + 1}>
                  {label}
                </option>
              ))}
            </Select>
            <Select
              label={t("labels.exportRangeTo")}
              value={String(rangeTo)}
              onChange={(event) => setRangeTo(Number(event.target.value))}
            >
              {monthNamesLong.map((label, index) => (
                <option key={label} value={index + 1}>
                  {label}
                </option>
              ))}
            </Select>
            <Button variant="secondary" onClick={exportRange}>
              {t("labels.exportRange")}
            </Button>
          </div>
        </CardBody>
      </Card>

      <TwintImportWizard />

      <Card>
        <CardHeader>
          <CardTitle>{t("labels.backup")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeReceipts}
              onChange={(event) => setIncludeReceipts(event.target.checked)}
            />
            <span>{t("labels.backupIncludeReceipts")}</span>
          </div>
          <Button
            onClick={async () => {
              try {
                const path = await api.createBackup({ include_receipts: includeReceipts });
                addToast({ title: t("labels.backupCreated"), description: path, variant: "success" });
              } catch (error) {
                const parsed = parseInvokeError(error);
                addToast({ title: t("labels.backupFailed"), description: parsed.message, variant: "danger" });
              }
            }}
          >
            {t("labels.backupCreate")}
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("labels.restoreDangerZone")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <Button
            variant="secondary"
            onClick={async () => {
              const path = await api.pickBackup();
              if (path) {
                setRestorePath(path);
                setConfirmRestore(true);
              }
            }}
          >
            {t("labels.chooseBackup")}
          </Button>
          {restorePath && <div className="text-xs text-app-neutral">{restorePath}</div>}
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirmRestore}
        title={t("labels.backupRestore")}
        description={t("labels.restoreOverwrite")}
        confirmLabel={t("labels.restoreStart")}
        onConfirm={async () => {
          if (!restorePath) return;
          try {
            await api.restoreBackup({ archive_path: restorePath });
            addToast({ title: t("labels.restoreDone"), variant: "success" });
            setConfirmRestore(false);
            setRestorePath(null);
          } catch (error) {
            const parsed = parseInvokeError(error);
            addToast({ title: t("labels.restoreFailed"), description: parsed.message, variant: "danger" });
          }
        }}
        onCancel={() => setConfirmRestore(false)}
      />
    </div>
  );
}
