import { useCallback, useEffect, useState } from "react";

import { api, parseInvokeError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { Category } from "../lib/types";
import { useToastStore } from "../state/toastStore";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Input } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "../components/ui/Table";
import { parseDecimalInput } from "../lib/parse";

const emptyCategory: Category = {
  id: 0,
  name: "",
  description: "",
  default_mwst_rate: 0,
  is_active: true,
};

export function CategoriesPage() {
  const { t } = useI18n();
  const addToast = useToastStore((state) => state.addToast);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Category>(emptyCategory);
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [quickAdd, setQuickAdd] = useState({ name: "", description: "", rate: "" });

  const load = useCallback(() => {
    api
      .listCategories()
      .then(setCategories)
      .catch((error) => {
        addToast({ title: t("labels.categoriesLoadFailed"), description: String(error), variant: "danger" });
      });
  }, [addToast, t]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    try {
      if (editing.id === 0) {
        await api.createCategory({
          name: editing.name,
          description: editing.description,
          default_mwst_rate: editing.default_mwst_rate,
        });
        addToast({ title: t("labels.categoryCreateSuccess"), variant: "success" });
      } else {
        await api.updateCategory({
          id: editing.id,
          name: editing.name,
          description: editing.description,
          default_mwst_rate: editing.default_mwst_rate,
          is_active: editing.is_active,
        });
        addToast({ title: t("labels.categoryUpdateSuccess"), variant: "success" });
      }
      setOpen(false);
      setEditing(emptyCategory);
      load();
    } catch (error) {
      const parsed = parseInvokeError(error);
      addToast({ title: t("labels.categorySaveFailed"), description: parsed.message, variant: "danger" });
    }
  };

  const submitQuickAdd = async () => {
    const name = quickAdd.name.trim();
    if (!name) {
      addToast({ title: t("labels.categoryNameRequired"), variant: "danger" });
      return;
    }
    const parsedRate = parseDecimalInput(quickAdd.rate);
    try {
      await api.createCategory({
        name,
        description: quickAdd.description.trim() || null,
        default_mwst_rate: parsedRate ?? 0,
      });
      addToast({ title: t("labels.categoryCreateSuccess"), variant: "success" });
      setQuickAdd({ name: "", description: "", rate: "" });
      load();
    } catch (error) {
      const parsed = parseInvokeError(error);
      addToast({ title: t("labels.categorySaveFailed"), description: parsed.message, variant: "danger" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">{t("nav.categories")}</h1>
          <p className="page-subtitle">{t("labels.categoryDefaults")}</p>
        </div>
        <Button
          onClick={() => {
            setEditing(emptyCategory);
            setOpen(true);
          }}
        >
          {t("labels.categoryNew")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("labels.categoryList")}</CardTitle>
        </CardHeader>
        <CardBody>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>{t("labels.name")}</TableHeaderCell>
                <TableHeaderCell>{t("labels.taxRate")}</TableHeaderCell>
                <TableHeaderCell>{t("labels.tableStatus")}</TableHeaderCell>
                <TableHeaderCell></TableHeaderCell>
              </TableRow>
            </TableHead>
            <tbody>
              {categories.map((category) => (
                <TableRow key={category.id}>
                  <TableCell>{category.name}</TableCell>
                  <TableCell>{category.default_mwst_rate.toFixed(1)}</TableCell>
                  <TableCell>
                    {category.is_active ? (
                      <Badge variant="success">{t("labels.active")}</Badge>
                    ) : (
                      <Badge variant="danger">{t("labels.inactive")}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setEditing(category);
                          setOpen(true);
                        }}
                      >
                        {t("actions.edit")}
                      </Button>
                      {category.is_active && (
                        <Button variant="danger" size="sm" onClick={() => setDeleteTarget(category)}>
                          {t("actions.delete")}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
          <div className="mt-4 border-t border-app-border pt-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-app-neutral">
              {t("labels.categoryQuickAdd")}
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <Input
                label={t("labels.name")}
                value={quickAdd.name}
                onChange={(event) => setQuickAdd({ ...quickAdd, name: event.target.value })}
              />
              <Input
                label={t("labels.description")}
                value={quickAdd.description}
                onChange={(event) => setQuickAdd({ ...quickAdd, description: event.target.value })}
              />
              <Input
                label={t("labels.taxRateStandard")}
                type="text"
                inputMode="decimal"
                value={quickAdd.rate}
                onChange={(event) => setQuickAdd({ ...quickAdd, rate: event.target.value })}
              />
              <div className="flex items-end justify-end">
                <Button variant="secondary" onClick={submitQuickAdd}>
                  {t("actions.add")}
                </Button>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={editing.id === 0 ? t("labels.categoryCreate") : t("labels.categoryEdit")}>
        <div className="space-y-3">
          <Input
            label={t("labels.name")}
            value={editing.name}
            onChange={(event) => setEditing({ ...editing, name: event.target.value })}
          />
          <Input
            label={t("labels.description")}
            value={editing.description ?? ""}
            onChange={(event) => setEditing({ ...editing, description: event.target.value })}
          />
          <Input
            label={t("labels.taxRateStandard")}
            type="text"
            inputMode="decimal"
            value={String(editing.default_mwst_rate)}
            onChange={(event) => {
              const parsed = parseDecimalInput(event.target.value);
              setEditing({ ...editing, default_mwst_rate: parsed ?? 0 });
            }}
          />
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={editing.is_active}
              onChange={(event) => setEditing({ ...editing, is_active: event.target.checked })}
            />
            <span className="text-xs text-app-neutral">{t("labels.active")}</span>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t("actions.cancel")}
            </Button>
            <Button onClick={save}>{t("actions.save")}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title={t("labels.categoryDeleteTitle")}
        description={t("labels.categoryDeleteBody", { name: deleteTarget?.name ?? "" })}
        confirmLabel={t("actions.delete")}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.deactivateCategory(deleteTarget.id);
            addToast({ title: t("labels.categoryDeleteSuccess"), variant: "success" });
            setDeleteTarget(null);
            load();
          } catch (error) {
            const parsed = parseInvokeError(error);
            addToast({ title: t("labels.categorySaveFailed"), description: parsed.message, variant: "danger" });
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
