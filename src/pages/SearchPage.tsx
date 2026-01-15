import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { api, parseInvokeError } from "../lib/api";
import { formatCHF, formatDate } from "../lib/format";
import { useI18n } from "../lib/i18n";
import type { Paginated, TransactionListItem } from "../lib/types";
import { useAppStore } from "../state/appStore";
import { useToastStore } from "../state/toastStore";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Modal } from "../components/ui/Modal";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "../components/ui/Table";

const typeBadge: Record<string, "success" | "warning" | "default"> = {
  INCOME: "success",
  EXPENSE: "warning",
  CORRECTION: "default",
};

export function SearchPage() {
  const { globalSearch, setGlobalSearch } = useAppStore();
  const { t, locale, monthNamesShort } = useI18n();
  const addToast = useToastStore((state) => state.addToast);
  const [searchParams] = useSearchParams();
  const [pageByQuery, setPageByQuery] = useState<Record<string, number>>({});
  const [data, setData] = useState<Paginated<TransactionListItem> | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedTx, setSelectedTx] = useState<TransactionListItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const requestId = useRef(0);

  const query = useMemo(() => {
    const param = searchParams.get("q") ?? "";
    return (param || globalSearch).trim();
  }, [globalSearch, searchParams]);

  useEffect(() => {
    const param = (searchParams.get("q") ?? "").trim();
    if (param && param !== globalSearch) {
      setGlobalSearch(param);
    }
  }, [globalSearch, searchParams, setGlobalSearch]);

  const pageSize = 100;
  const page = pageByQuery[query] ?? 1;
  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  const loadResults = useCallback(
    (currentQuery: string, currentPage: number) => {
      if (currentQuery.length < 2) {
        setData(null);
        setLoading(false);
        return;
      }
      const currentId = ++requestId.current;
      setLoading(true);
      api
        .searchTransactionsPaged(currentQuery, currentPage, pageSize)
        .then((result) => {
          if (requestId.current !== currentId) return;
          setData(result);
        })
        .catch((error) => {
          if (requestId.current !== currentId) return;
          const parsed = parseInvokeError(error);
          addToast({ title: t("labels.searchFailed"), description: parsed.message, variant: "danger" });
        })
        .finally(() => {
          if (requestId.current !== currentId) return;
          setLoading(false);
        });
    },
    [addToast, pageSize, t]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadResults(query, page);
  }, [loadResults, page, query]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("labels.searchResultsTitle")}</h1>
        <p className="page-subtitle">{t("labels.searchResultsSubtitle")}</p>
        {query && <div className="mt-2 text-xs text-app-neutral">{t("labels.searchQuery", { query })}</div>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("labels.searchResults")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {query.length < 2 && (
            <div className="text-sm text-app-neutral">{t("labels.searchNoQuery")}</div>
          )}
          {query.length >= 2 && loading && (
            <div className="text-sm text-app-neutral">{t("labels.searching")}</div>
          )}
          {query.length >= 2 && !loading && (data?.items.length ?? 0) === 0 && (
            <div className="text-sm text-app-neutral">{t("labels.searchNoResults")}</div>
          )}
          {query.length >= 2 && !loading && data && data.items.length > 0 && (
            <>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>{t("labels.tableId")}</TableHeaderCell>
                    <TableHeaderCell>{t("labels.tableDate")}</TableHeaderCell>
                    <TableHeaderCell>{t("labels.type")}</TableHeaderCell>
                    <TableHeaderCell>{t("labels.tableCategory")}</TableHeaderCell>
                    <TableHeaderCell>{t("labels.tableAmount")}</TableHeaderCell>
                    <TableHeaderCell>{t("labels.month")}</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <tbody>
                  {data.items.map((item) => (
                    <TableRow key={item.id} className="cursor-pointer hover:bg-app-surface" onClick={() => setSelectedTx(item)}>
                      <TableCell className="font-medium text-app-primary">{item.public_id}</TableCell>
                      <TableCell>{formatDate(item.date, locale)}</TableCell>
                      <TableCell>
                        <Badge variant={typeBadge[item.type] ?? "default"}>{item.type}</Badge>
                      </TableCell>
                      <TableCell>{item.category_name ?? item.payment_method ?? "-"}</TableCell>
                      <TableCell className="font-medium text-app-primary">{formatCHF(item.amount_chf, locale)}</TableCell>
                      <TableCell>
                        {monthNamesShort[item.month - 1]} {item.year}
                      </TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
              {totalPages > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-app-neutral">
                    {t("labels.pageOf", { page, total: totalPages })}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() =>
                        setPageByQuery((prev) => ({
                          ...prev,
                          [query]: Math.max(1, page - 1),
                        }))
                      }
                    >
                      {t("actions.previous")}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() =>
                        setPageByQuery((prev) => ({
                          ...prev,
                          [query]: page + 1,
                        }))
                      }
                    >
                      {t("actions.next")}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>

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
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              {t("labels.deleteTx")}
            </Button>
          </div>
        )}
      </Modal>

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
            loadResults(query, page);
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
