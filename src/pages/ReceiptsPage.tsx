import { useEffect, useState } from "react";
import { api, parseInvokeError } from "../lib/api";
import { formatCHF, formatDate } from "../lib/format";
import { useI18n } from "../lib/i18n";
import type { Paginated, TransactionListItem } from "../lib/types";
import { useAppStore } from "../state/appStore";
import { useToastStore } from "../state/toastStore";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { Modal } from "../components/ui/Modal";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "../components/ui/Table";

const isImagePath = (path: string | null | undefined) => !!path && /\.(png|jpg|jpeg)$/i.test(path);

export function ReceiptsPage() {
  const { year, month, globalSearch } = useAppStore();
  const { t, locale } = useI18n();
  const addToast = useToastStore((state) => state.addToast);
  const [data, setData] = useState<Paginated<TransactionListItem> | null>(null);
  const [previewData, setPreviewData] = useState<{ src: string; name: string } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      api
        .listTransactions({
          year,
          month,
          tx_type: "EXPENSE",
          page: 1,
          page_size: 500,
          search: globalSearch,
        })
        .then((result) => setData(result))
        .catch((error) => {
          addToast({
            title: t("labels.receiptsLoadFailed"),
            description: String(error),
            variant: "danger",
          });
        });
    }, 200);

    return () => clearTimeout(timeout);
  }, [year, month, globalSearch, addToast, t]);

  const missing = data?.items.filter((item) => !item.receipt_path && item.amount_chf > 0) ?? [];
  const hasSearch = globalSearch.trim().length > 0;
  const previewSrc = previewData?.src ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("nav.receipts")}</h1>
        <p className="page-subtitle">{t("labels.receiptCheck")}</p>
        {hasSearch && <div className="mt-2 text-xs text-app-neutral">{t("labels.filterActive", { query: globalSearch })}</div>}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("labels.missingReceiptsMonth")}</CardTitle>
        </CardHeader>
        <CardBody>
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
              {missing.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-sm text-app-neutral">
                    {t("labels.noMissingReceipts")}
                  </TableCell>
                </TableRow>
              )}
              {missing.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="sticky left-0 bg-app-card font-medium">{tx.public_id}</TableCell>
                  <TableCell>{formatDate(tx.date, locale)}</TableCell>
                  <TableCell>{tx.category_name ?? "-"}</TableCell>
                  <TableCell>{formatCHF(tx.amount_chf, locale)}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("labels.allReceiptsMonth")}</CardTitle>
        </CardHeader>
        <CardBody>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell className="sticky left-0 bg-app-surface">{t("labels.tableId")}</TableHeaderCell>
                <TableHeaderCell>{t("labels.tableReceipt")}</TableHeaderCell>
                <TableHeaderCell></TableHeaderCell>
              </TableRow>
            </TableHead>
            <tbody>
              {data?.items.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="sticky left-0 bg-app-card font-medium">{tx.public_id}</TableCell>
                  <TableCell className="text-xs text-app-neutral">{tx.receipt_path ?? t("labels.noReceipt")}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {isImagePath(tx.receipt_path) && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={async () => {
                            if (!tx.receipt_path) return;
                            setPreviewBusy(true);
                            setPreviewData({ src: "", name: tx.receipt_path });
                            try {
                              const file = await api.readReceiptFile(tx.receipt_path);
                              const src = `data:${file.content_type};base64,${file.data_base64}`;
                              setPreviewData({ src, name: tx.receipt_path });
                            } catch (error) {
                              const parsed = parseInvokeError(error);
                              addToast({
                                title: t("labels.receiptPreviewFailed"),
                                description: parsed.message,
                                variant: "danger",
                              });
                              setPreviewData(null);
                            } finally {
                              setPreviewBusy(false);
                            }
                          }}
                          disabled={previewBusy}
                        >
                          {t("labels.preview")}
                        </Button>
                      )}
                      {tx.receipt_path && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={async () => {
                            try {
                              await api.openReceipt(tx.receipt_path ?? "");
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
                          {t("actions.open")}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <Modal open={!!previewData} onClose={() => setPreviewData(null)} title={t("labels.receiptPreviewTitle")}>
        {previewBusy ? (
          <div className="text-sm text-app-neutral">{t("labels.loadingHint")}</div>
        ) : previewSrc ? (
          <img src={previewSrc} alt={t("labels.receipt")} className="max-h-[70vh] w-full rounded-lg object-contain" />
        ) : (
          <div className="text-sm text-app-neutral">{t("labels.noPreview")}</div>
        )}
      </Modal>
    </div>
  );
}
