import { useEffect, useState } from "react";

import { api, parseInvokeError } from "../lib/api";
import { parseDecimalInput } from "../lib/parse";
import { useI18n } from "../lib/i18n";
import { formatCHF, formatDate } from "../lib/format";
import type { Settings, SyncConflictSummary, SyncStatus } from "../lib/types";
import { useAppStore } from "../state/appStore";
import { useToastStore } from "../state/toastStore";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";

const seedOptions = [
  { value: "5000", labelKey: "seed.5k" },
  { value: "30000", labelKey: "seed.30k" },
  { value: "80000", labelKey: "seed.80k" },
  { value: "150000", labelKey: "seed.150k" },
];

export function SettingsPage() {
  const {
    settings,
    setSettings,
    setYear,
    language,
    setLanguage,
    density,
    setDensity,
    uiScale,
    setUiScale,
    ocrMode,
    setOcrMode,
    ocrApiKey,
    setOcrApiKey,
  } = useAppStore();
  const { t, locale } = useI18n();
  const addToast = useToastStore((state) => state.addToast);
  const [form, setForm] = useState<Settings | null>(settings);
  const [seedCount, setSeedCount] = useState(seedOptions[1].value);
  const [seedOpen, setSeedOpen] = useState(false);
  const [seedBusy, setSeedBusy] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);

  const formatTimestamp = (value?: string | null) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return value;
    return date.toLocaleString(locale);
  };

  const renderSummary = (summary?: SyncConflictSummary | null) => {
    if (!summary) {
      return <div className="text-xs text-app-neutral">{t("labels.syncSummaryUnavailable")}</div>;
    }
    return (
      <div className="space-y-1 text-xs">
        <div className="text-sm font-medium">{t("labels.syncSummaryTransactions", { count: summary.tx_count })}</div>
        <div className="text-app-neutral">{t("labels.syncSummaryIncome", { value: formatCHF(summary.income_total, locale) })}</div>
        <div className="text-app-neutral">{t("labels.syncSummaryExpense", { value: formatCHF(summary.expense_total, locale) })}</div>
        <div className="mt-2 space-y-1">
          {summary.last_items.map((item, index) => (
            <div key={`${item.date}-${index}`} className="flex items-center justify-between gap-2">
              <span className="text-app-neutral">{formatDate(item.date, locale)}</span>
              <span className="truncate">{item.label}</span>
              <span className="font-medium">{formatCHF(item.amount_chf, locale)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  useEffect(() => {
    setForm(settings ?? null);
  }, [settings]);

  useEffect(() => {
    let active = true;
    const loadSync = async () => {
      try {
        const status = await api.getSyncStatus();
        if (active) setSyncStatus(status);
      } catch (error) {
        const parsed = parseInvokeError(error);
        addToast({ title: t("labels.syncStatusFailed"), description: parsed.message, variant: "danger" });
      }
    };
    loadSync();
    const timer = window.setInterval(loadSync, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [addToast, t]);

  if (!form) {
    return <div className="page-subtitle">{t("labels.appLoadSettings")}</div>;
  }

  const save = async () => {
    try {
      const updated = await api.updateSettings(form);
      setSettings(updated);
      setYear(updated.current_year);
      addToast({ title: t("labels.settingsSaved"), variant: "success" });
    } catch (error) {
      const parsed = parseInvokeError(error);
      addToast({ title: t("labels.settingsSaveFailed"), description: parsed.message, variant: "danger" });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("labels.settings")}</h1>
        <p className="page-subtitle">{t("labels.settingsSubtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("labels.general")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <Input
            type="number"
            label={t("labels.currentYear")}
            value={form.current_year}
            onChange={(event) => setForm({ ...form, current_year: Number(event.target.value) })}
          />
          <Select
            label={t("labels.taxMode")}
            value={form.mwst_mode}
            onChange={(event) => setForm({ ...form, mwst_mode: event.target.value as Settings["mwst_mode"] })}
          >
            <option value="EFFEKTIV">{t("labels.taxModeEffective")}</option>
            <option value="SALDO">{t("labels.taxModeSaldo")}</option>
          </Select>
          <Input
            type="text"
            inputMode="decimal"
            label={t("labels.taxSaldoRate")}
            value={String(form.mwst_saldo_rate)}
            onChange={(event) => {
              const parsed = parseDecimalInput(event.target.value);
              setForm({ ...form, mwst_saldo_rate: parsed ?? 0 });
            }}
          />
          <div>
            <Input
              label={t("labels.receiptsFolder")}
              value={form.receipt_base_folder}
              onChange={(event) => setForm({ ...form, receipt_base_folder: event.target.value })}
            />
            <div className="mt-2">
              <Button
                variant="secondary"
                onClick={async () => {
                  const selected = await api.pickFolder();
                  if (selected) {
                    setForm({ ...form, receipt_base_folder: selected });
                  }
                }}
              >
                {t("labels.chooseFolder")}
              </Button>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={save}>{t("actions.save")}</Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("labels.language")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <Select label={t("labels.language")} value={language} onChange={(event) => setLanguage(event.target.value as typeof language)}>
            <option value="de">{t("labels.languageGerman")}</option>
            <option value="it">{t("labels.languageItalian")}</option>
          </Select>
          <div className="text-xs text-app-neutral">{t("labels.languageSwitchHint")}</div>
          <Select label={t("labels.density")} value={density} onChange={(event) => setDensity(event.target.value as typeof density)}>
            <option value="standard">{t("labels.densityStandard")}</option>
            <option value="comfort">{t("labels.densityComfort")}</option>
          </Select>
          <Select label={t("labels.uiScale")} value={String(uiScale)} onChange={(event) => setUiScale(Number(event.target.value))}>
            <option value="90">90%</option>
            <option value="100">100%</option>
            <option value="110">110%</option>
            <option value="120">120%</option>
            <option value="130">130%</option>
          </Select>
          <div className="text-xs text-app-neutral">{t("labels.uiScaleHint")}</div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("labels.ocrTitle")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <Select
            label={t("labels.ocrMode")}
            value={ocrMode}
            onChange={(event) => setOcrMode(event.target.value as typeof ocrMode)}
          >
            <option value="auto">{t("labels.ocrModeAuto")}</option>
            <option value="offline">{t("labels.ocrModeOffline")}</option>
            <option value="online">{t("labels.ocrModeOnline")}</option>
          </Select>
          <Input
            type="password"
            label={t("labels.ocrApiKey")}
            value={ocrApiKey}
            onChange={(event) => setOcrApiKey(event.target.value)}
            placeholder={t("labels.ocrApiKeyPlaceholder")}
          />
          <div className="text-xs text-app-neutral">{t("labels.ocrHint")}</div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("labels.localSyncTitle")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="text-xs text-app-neutral">{t("labels.localSyncHint")}</div>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <div className="text-xs text-app-neutral">{t("labels.localSyncStatus")}</div>
              <div className="text-sm font-medium">
                {syncStatus?.active ? t("labels.localSyncActive") : t("labels.localSyncInactive")}
              </div>
            </div>
            <div>
              <div className="text-xs text-app-neutral">{t("labels.localSyncAddress")}</div>
              <div className="text-sm font-medium">
                {syncStatus ? `http://${syncStatus.local_ip}:${syncStatus.port}` : "-"}
              </div>
            </div>
            <div>
              <div className="text-xs text-app-neutral">{t("labels.localSyncCode")}</div>
              <div className="text-lg font-semibold tracking-widest">{syncStatus?.pair_code ?? "-"}</div>
            </div>
          </div>
          <div className="text-xs text-app-neutral">
            {t("labels.localSyncLastChange", { value: formatTimestamp(syncStatus?.last_change ?? "-") })}
          </div>

          <div className="space-y-2">
            <div className="text-xs text-app-neutral">{t("labels.localSyncPairedDevices")}</div>
            {syncStatus?.paired_devices?.length ? (
              <div className="grid gap-2 md:grid-cols-2">
                {syncStatus.paired_devices.map((device) => (
                  <div key={device.device_id} className="rounded-lg border border-app-divider p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">{device.device_name}</div>
                      <div className="text-xs text-app-neutral">{device.last_known_ip ?? "-"}</div>
                    </div>
                    <div className="text-xs text-app-neutral">
                      {t("labels.localSyncLastSync", { value: formatTimestamp(device.last_sync_at) })}
                    </div>
                    <div className="text-xs text-app-neutral">
                      {t("labels.localSyncRemoteChange", { value: formatTimestamp(device.last_remote_change) })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-app-neutral">{t("labels.localSyncNoDevices")}</div>
            )}
          </div>

          {syncStatus?.pending_conflict && (
            <div className="rounded-xl border border-app-divider bg-app-surface/60 p-4">
              <div className="text-sm font-semibold">{t("labels.syncConflictTitle")}</div>
              <div className="text-xs text-app-neutral">
                {t("labels.syncConflictHint", { device: syncStatus.pending_conflict.device_name })}
              </div>
              <div className="text-xs text-app-neutral">
                {t("labels.syncConflictReceived", { value: formatTimestamp(syncStatus.pending_conflict.received_at) })}
              </div>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-app-divider/60 p-3">
                  <div className="text-xs text-app-neutral">{t("labels.syncConflictLocal")}</div>
                  <div className="text-xs text-app-neutral">
                    {t("labels.syncConflictLastChange", {
                      value: formatTimestamp(syncStatus.pending_conflict.local_last_change),
                    })}
                  </div>
                  <div className="mt-2">{renderSummary(syncStatus.pending_conflict.local_summary)}</div>
                </div>
                <div className="rounded-lg border border-app-divider/60 p-3">
                  <div className="text-xs text-app-neutral">{t("labels.syncConflictRemote")}</div>
                  <div className="text-xs text-app-neutral">
                    {t("labels.syncConflictLastChange", {
                      value: formatTimestamp(syncStatus.pending_conflict.remote_last_change),
                    })}
                  </div>
                  <div className="mt-2">{renderSummary(syncStatus.pending_conflict.remote_summary)}</div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button
                  variant="secondary"
                  disabled={syncBusy}
                  onClick={async () => {
                    setSyncBusy(true);
                    try {
                      const status = await api.resolveSyncConflict("KEEP_LOCAL");
                      setSyncStatus(status);
                      addToast({ title: t("labels.syncResolved"), variant: "success" });
                    } catch (error) {
                      const parsed = parseInvokeError(error);
                      addToast({ title: t("labels.syncResolveFailed"), description: parsed.message, variant: "danger" });
                    } finally {
                      setSyncBusy(false);
                    }
                  }}
                >
                  {t("actions.syncKeepLocal")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={syncBusy}
                  onClick={async () => {
                    setSyncBusy(true);
                    try {
                      const status = await api.resolveSyncConflict("USE_REMOTE");
                      setSyncStatus(status);
                      addToast({ title: t("labels.syncResolved"), variant: "success" });
                    } catch (error) {
                      const parsed = parseInvokeError(error);
                      addToast({ title: t("labels.syncResolveFailed"), description: parsed.message, variant: "danger" });
                    } finally {
                      setSyncBusy(false);
                    }
                  }}
                >
                  {t("actions.syncUseRemote")}
                </Button>
                <Button
                  disabled={syncBusy}
                  onClick={async () => {
                    setSyncBusy(true);
                    try {
                      const status = await api.resolveSyncConflict("MERGE");
                      setSyncStatus(status);
                      addToast({ title: t("labels.syncResolved"), variant: "success" });
                    } catch (error) {
                      const parsed = parseInvokeError(error);
                      addToast({ title: t("labels.syncResolveFailed"), description: parsed.message, variant: "danger" });
                    } finally {
                      setSyncBusy(false);
                    }
                  }}
                >
                  {t("actions.syncMerge")}
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("labels.demoData")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-app-neutral">{t("labels.demoDataHint")}</p>
          <Select label={t("labels.dataVolume")} value={seedCount} onChange={(event) => setSeedCount(event.target.value)}>
            {seedOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </Select>
          <div className="flex items-center justify-between">
            <span className="text-xs text-app-neutral">{t("labels.dataMayTake")}</span>
            <Button variant="secondary" onClick={() => setSeedOpen(true)} disabled={seedBusy}>
              {t("labels.demoData")}
            </Button>
          </div>
          <div className="flex items-center justify-between border-t border-app-divider/60 pt-3">
            <span className="text-xs text-app-neutral">{t("labels.demoDeleteHint")}</span>
            <Button variant="danger" onClick={() => setClearOpen(true)} disabled={clearBusy}>
              {t("labels.demoDeleteAction")}
            </Button>
          </div>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={seedOpen}
        title={t("labels.demoDataConfirmTitle")}
        description={t("labels.demoDataConfirmBody")}
        confirmLabel={t("labels.demoDataConfirmAction")}
        onConfirm={async () => {
          setSeedBusy(true);
          try {
            const count = await api.seedMockData(Number(seedCount));
            addToast({
              title: t("labels.demoDataCreated"),
              description: t("labels.demoDataCreatedCount", { count }),
              variant: "success",
            });
            setSeedOpen(false);
          } catch (error) {
            const parsed = parseInvokeError(error);
            addToast({ title: t("labels.demoDataFailed"), description: parsed.message, variant: "danger" });
          } finally {
            setSeedBusy(false);
          }
        }}
        onCancel={() => setSeedOpen(false)}
      />
      <ConfirmDialog
        open={clearOpen}
        title={t("labels.demoDeleteConfirmTitle")}
        description={t("labels.demoDeleteConfirmBody")}
        confirmLabel={t("labels.demoDeleteConfirmAction")}
        onConfirm={async () => {
          setClearBusy(true);
          try {
            const count = await api.clearDemoData();
            addToast({
              title: t("labels.demoDeleteSuccess"),
              description: t("labels.demoDeleteSuccessCount", { count }),
              variant: "success",
            });
            setClearOpen(false);
          } catch (error) {
            const parsed = parseInvokeError(error);
            addToast({ title: t("labels.demoDeleteFailed"), description: parsed.message, variant: "danger" });
          } finally {
            setClearBusy(false);
          }
        }}
        onCancel={() => setClearOpen(false)}
      />
    </div>
  );
}
