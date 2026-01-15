import { useCallback, useEffect, useState } from "react";

import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { AuditLogEntry, Paginated } from "../lib/types";
import { useToastStore } from "../state/toastStore";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "../components/ui/Table";

export function AuditLogPage() {
  const { t } = useI18n();
  const addToast = useToastStore((state) => state.addToast);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<AuditLogEntry> | null>(null);

  const load = useCallback(() => {
    api
      .listAuditLog(page, 200)
      .then(setData)
      .catch((error) => {
        addToast({
          title: t("labels.auditLoadFailed"),
          description: String(error),
          variant: "danger",
        });
      });
  }, [addToast, page, t]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">{t("nav.audit")}</h1>
          <p className="page-subtitle">{t("labels.auditSubtitle")}</p>
        </div>
        <Button variant="secondary" onClick={load}>
          {t("actions.update")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("labels.auditEntries")}</CardTitle>
        </CardHeader>
        <CardBody>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>{t("labels.auditTime")}</TableHeaderCell>
                <TableHeaderCell>{t("labels.auditAction")}</TableHeaderCell>
                <TableHeaderCell>{t("labels.auditEntity")}</TableHeaderCell>
                <TableHeaderCell>{t("labels.auditDetails")}</TableHeaderCell>
              </TableRow>
            </TableHead>
            <tbody>
              {data?.items.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="text-xs text-app-neutral">{entry.ts}</TableCell>
                  <TableCell>{entry.action}</TableCell>
                  <TableCell>
                    {entry.entity_type} {entry.entity_id ?? ""}
                  </TableCell>
                  <TableCell className="text-xs text-app-neutral">{entry.details ?? "-"}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-app-neutral">
              {t("labels.total")}: {data?.total ?? 0}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPage(Math.max(1, page - 1))}>
                {t("labels.previousPage")}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setPage(page + 1)}>
                {t("labels.nextPage")}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
