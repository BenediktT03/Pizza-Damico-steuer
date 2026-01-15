import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { api, parseInvokeError } from "../lib/api";
import { formatIsoDate } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { parseReceiptText, runReceiptOcr } from "../lib/ocr";
import { parseDecimalInput } from "../lib/parse";
import type { Category } from "../lib/types";
import { useAppStore } from "../state/appStore";
import { useToastStore } from "../state/toastStore";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Input } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { Select } from "../components/ui/Select";

type FormInput = {
  date: string;
  category_id: number;
  description?: string;
  amount_chf: string | number;
  mwst_rate?: string | number;
  note?: string;
};

type FormValues = {
  date: string;
  category_id: number;
  description?: string;
  amount_chf: number;
  mwst_rate?: number;
  note?: string;
};

type OcrDraft = {
  date: string;
  amount: string;
  mwstRate: string;
  description: string;
  note: string;
  categoryId: number;
};

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");

const tokenise = (value: string) =>
  normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);

const categoryHints = [
  { match: ["lebensmittel", "zutaten", "einkauf", "food", "aliment"], keywords: ["migros", "coop", "lidl", "aldi", "market", "cash"] },
  { match: ["verpack", "pack", "box", "becher"], keywords: ["box", "becher", "deckel", "folie", "take", "away", "verpack"] },
  { match: ["fahr", "treib", "tank", "fuel", "benz", "diesel"], keywords: ["shell", "bp", "avia", "agip", "eni", "esso", "tank"] },
  { match: ["reinigung", "clean", "deterg"], keywords: ["reinigung", "putz", "deterg", "clean", "soap"] },
  { match: ["marketing", "werbung", "promo"], keywords: ["werbung", "promo", "promotion", "facebook", "instagram", "ads", "flyer"] },
  { match: ["standplatz", "miete", "gebuehr", "gebuehren"], keywords: ["miete", "rent", "gebuehr", "stand", "platz"] },
  { match: ["versicherung", "insurance", "assicur"], keywords: ["versicherung", "insurance", "assicur"] },
  { match: ["reparatur", "wartung", "service"], keywords: ["reparatur", "wartung", "service", "officina"] },
];

const suggestCategoryId = (text: string, categories: Category[]): number | null => {
  if (!text || categories.length === 0) return null;
  const haystack = normalizeText(text);
  let best: { id: number; score: number } | null = null;
  for (const category of categories) {
    if (!category.is_active) continue;
    const name = normalizeText(category.name);
    const description = normalizeText(category.description ?? "");
    const keywords = tokenise(`${name} ${description}`);
    let score = 0;
    for (const keyword of keywords) {
      if (haystack.includes(keyword)) {
        score += Math.min(4, 1 + keyword.length / 5);
      }
    }
    for (const hint of categoryHints) {
      if (!hint.match.some((match) => name.includes(match))) continue;
      if (hint.keywords.some((keyword) => haystack.includes(keyword))) {
        score += 3;
      }
    }
    if (!best || score > best.score) {
      best = { id: category.id, score };
    }
  }
  return best && best.score >= 2 ? best.id : null;
};

export function ExpensePage() {
  const { t, language } = useI18n();
  const { ocrMode, ocrApiKey } = useAppStore();
  const addToast = useToastStore((state) => state.addToast);
  const [categories, setCategories] = useState<Category[]>([]);
  const [receiptPath, setReceiptPath] = useState<string | null>(null);
  const [confirmMissingReceipt, setConfirmMissingReceipt] = useState<FormValues | null>(null);
  const [duplicateState, setDuplicateState] = useState<{ message: string; data: FormValues } | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{ progress: number; status: string } | null>(null);
  const [ocrDraft, setOcrDraft] = useState<OcrDraft | null>(null);
  const [ocrOpen, setOcrOpen] = useState(false);

  const mwstOptions = useMemo(
    () => [
      { value: "", label: t("labels.taxFromCategory") },
      { value: "0", label: `0% (${t("labels.none")})` },
      { value: "2.6", label: `2.6% ${t("labels.reduced")}` },
      { value: "3.8", label: `3.8% ${t("labels.accommodation")}` },
      { value: "7.7", label: `7.7% ${t("labels.oldRate")}` },
      { value: "8.1", label: `8.1% ${t("labels.standard")}` },
    ],
    [t]
  );

  const schema = useMemo(
    () =>
      z.object({
        date: z.string().min(1, t("errors.dateRequired")),
        category_id: z.number().min(1, t("errors.categoryRequired")),
        description: z.string().optional(),
        amount_chf: z.preprocess(parseDecimalInput, z.number().positive(t("errors.amountPositive"))),
        mwst_rate: z.preprocess(parseDecimalInput, z.number().min(0).max(99.9, t("errors.taxRateRange")).optional()),
        note: z.string().optional(),
      }),
    [t]
  );

  const defaultValues = useMemo<FormInput>(
    () => ({
      date: formatIsoDate(new Date()),
      category_id: 0,
      description: "",
      amount_chf: "",
      mwst_rate: "",
      note: "",
    }),
    []
  );

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    getValues,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormInput>({
    resolver: zodResolver(schema),
    defaultValues,
  });

  const mwstValue = useWatch({ control, name: "mwst_rate" });
  const categoryValue = useWatch({ control, name: "category_id" });

  const categoryRegister = register("category_id", {
    valueAsNumber: true,
    onChange: (event) => {
      const nextId = Number(event.target.value);
      const selected = categories.find((category) => category.id === nextId);
      if (selected) {
        setValue("mwst_rate", String(selected.default_mwst_rate));
      }
    },
  });

  useEffect(() => {
    api
      .listCategories()
      .then((data) => setCategories(data.filter((category) => category.is_active)))
      .catch((error) => {
        addToast({
          title: t("labels.categoriesLoadFailed"),
          description: String(error),
          variant: "danger",
        });
      });
  }, [addToast, t]);

  const startOcr = async (existingPath?: string | null) => {
    const selectedPath = existingPath ?? (await api.pickReceipt());
    if (!selectedPath) return;
    setReceiptPath(selectedPath);
    setOcrBusy(true);
    setOcrProgress({ progress: 0, status: t("labels.ocrRunning") });
    try {
      const fileData = await api.readReceiptFile(selectedPath);
      const result = await runReceiptOcr(
        { dataBase64: fileData.data_base64, contentType: fileData.content_type },
        {
          mode: ocrMode,
          apiKey: ocrApiKey,
          uiLanguage: language,
          onProgress: (progress, status) => setOcrProgress({ progress, status }),
        }
      );
      const suggestion = parseReceiptText(result.text);
      const suggestionText = [result.text, suggestion.description, suggestion.note].filter(Boolean).join(" ");
      const suggestedCategoryId = suggestCategoryId(suggestionText, categories);
      const suggestedCategory = categories.find((category) => category.id === suggestedCategoryId);
      const fallbackMwstRate = suggestedCategory ? String(suggestedCategory.default_mwst_rate) : "";
      const mwstRate = suggestion.mwstRate !== undefined ? String(suggestion.mwstRate) : fallbackMwstRate;
      setOcrDraft({
        date: suggestion.date ?? "",
        amount: suggestion.amount !== undefined ? String(suggestion.amount) : "",
        mwstRate,
        description: suggestion.description ?? "",
        note: suggestion.note ?? "",
        categoryId: suggestedCategoryId ?? 0,
      });
      setOcrOpen(true);
    } catch (error) {
      const parsed = parseInvokeError(error);
      addToast({
        title: t("labels.ocrFailed"),
        description: parsed.message,
        variant: "danger",
      });
    } finally {
      setOcrBusy(false);
      setOcrProgress(null);
    }
  };

  const submit = async (values: FormValues, allowDuplicate?: boolean) => {
    try {
      const tx = await api.createExpense({
        ...values,
        receipt_source_path: receiptPath,
        allow_duplicate: allowDuplicate,
      });
      addToast({
        title: `${t("labels.save")}: ID ${tx.public_id}`,
        variant: "success",
      });
      reset(defaultValues);
      setReceiptPath(null);
    } catch (error) {
      const parsed = parseInvokeError(error);
      if (parsed.code === "DUPLICATE_WARNING") {
        setDuplicateState({ message: parsed.message, data: values });
        return;
      }
      addToast({
        title: t("labels.expenseSaveFailed"),
        description: parsed.message,
        variant: "danger",
      });
    }
  };

  const applyOcrSuggestion = () => {
    if (!ocrDraft) {
      setOcrOpen(false);
      return;
    }
    if (ocrDraft.date) {
      setValue("date", ocrDraft.date);
    }
    if (ocrDraft.amount) {
      setValue("amount_chf", ocrDraft.amount);
    }
    if (ocrDraft.description && !getValues("description")) {
      setValue("description", ocrDraft.description);
    }
    if (ocrDraft.note && !getValues("note")) {
      setValue("note", ocrDraft.note);
    }
    if (ocrDraft.categoryId && (!categoryValue || categoryValue === 0)) {
      setValue("category_id", ocrDraft.categoryId);
      const selected = categories.find((category) => category.id === ocrDraft.categoryId);
      if (selected && !ocrDraft.mwstRate) {
        setValue("mwst_rate", String(selected.default_mwst_rate));
      }
    }
    if (ocrDraft.mwstRate) {
      setValue("mwst_rate", ocrDraft.mwstRate);
    }
    setOcrOpen(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("labels.expenseTitle")}</h1>
        <p className="page-subtitle">{t("labels.expenseSubtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t("labels.expenseFormTitle")}</CardTitle>
            <p className="text-xs text-app-neutral">{t("labels.expenseFormHint")}</p>
          </div>
        </CardHeader>
        <CardBody>
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={handleSubmit(
              (values) => {
                const parsed = schema.parse(values);
                if (!receiptPath) {
                  setConfirmMissingReceipt(parsed);
                  return;
                }
                submit(parsed);
              },
              (formErrors) => {
                const firstError = Object.values(formErrors).find((error) => error?.message);
                if (firstError?.message) {
                  addToast({ title: firstError.message, variant: "danger" });
                }
              }
            )}
          >
            <Input type="date" label={t("labels.date")} error={errors.date?.message} {...register("date")} />
            <Select
              label={t("labels.category")}
              error={errors.category_id?.message}
              {...categoryRegister}
            >
              <option value={0}>{t("labels.selectPlaceholder")}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
            <Input label={t("labels.description")} {...register("description")} />
            <Input
              type="text"
              inputMode="decimal"
              label={t("labels.amountChf")}
              placeholder="0.00"
              error={errors.amount_chf?.message}
              {...register("amount_chf")}
            />
            <Input
              type="text"
              inputMode="decimal"
              label={t("labels.taxRateOptional")}
              placeholder={t("labels.taxFromCategory")}
              error={errors.mwst_rate?.message}
              {...register("mwst_rate")}
            />
            <Select
              label={t("labels.taxRateStandard")}
              value={mwstOptions.some((opt) => opt.value === String(mwstValue ?? "")) ? String(mwstValue ?? "") : ""}
              onChange={(event) => setValue("mwst_rate", event.target.value)}
            >
              {mwstOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Input label={t("labels.note")} {...register("note")} />
            <div className="md:col-span-2">
              <div className="text-xs font-medium text-app-neutral">{t("labels.receipt")}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={async () => {
                    try {
                      const selected = await api.pickReceipt();
                      if (selected) setReceiptPath(selected);
                    } catch (error) {
                      const parsed = parseInvokeError(error);
                      addToast({
                        title: t("labels.receiptPickFailed"),
                        description: parsed.message,
                        variant: "danger",
                      });
                    }
                  }}
                >
                  {t("labels.pickReceipt")}
                </Button>
                <Button type="button" variant="secondary" onClick={() => startOcr(receiptPath)} disabled={ocrBusy}>
                  {t("labels.receiptScan")}
                </Button>
                {ocrBusy && (
                  <span className="text-xs text-app-neutral">
                    {t("labels.ocrRunning")}{" "}
                    {ocrProgress ? `${Math.round(ocrProgress.progress * 100)}%` : ""}
                  </span>
                )}
              </div>
              <div className="mt-2 text-xs text-app-neutral">
                {receiptPath ? receiptPath : t("labels.noReceiptSelected")}
              </div>
            </div>
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" disabled={isSubmitting}>
                {t("labels.save")}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Modal open={ocrOpen} onClose={() => setOcrOpen(false)} title={t("labels.ocrReviewTitle")}>
        <div className="space-y-3 text-sm">
          <p className="text-app-neutral">{t("labels.ocrReviewHint")}</p>
          <Select
            label={t("labels.category")}
            value={ocrDraft?.categoryId ?? 0}
            onChange={(event) => {
              const nextId = Number(event.target.value);
              const selected = categories.find((category) => category.id === nextId);
              setOcrDraft((prev) => ({
                date: prev?.date ?? "",
                amount: prev?.amount ?? "",
                mwstRate: selected ? String(selected.default_mwst_rate) : prev?.mwstRate ?? "",
                description: prev?.description ?? "",
                note: prev?.note ?? "",
                categoryId: nextId,
              }));
            }}
          >
            <option value={0}>{t("labels.selectPlaceholder")}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
          <Input
            type="date"
            label={t("labels.date")}
            value={ocrDraft?.date ?? ""}
            onChange={(event) => {
              const next = event.target.value;
              setOcrDraft((prev) => ({
                date: next,
                amount: prev?.amount ?? "",
                mwstRate: prev?.mwstRate ?? "",
                description: prev?.description ?? "",
                note: prev?.note ?? "",
                categoryId: prev?.categoryId ?? 0,
              }));
            }}
          />
          <Input
            type="text"
            inputMode="decimal"
            label={t("labels.amountChf")}
            value={ocrDraft?.amount ?? ""}
            onChange={(event) => {
              const next = event.target.value;
              setOcrDraft((prev) => ({
                date: prev?.date ?? "",
                amount: next,
                mwstRate: prev?.mwstRate ?? "",
                description: prev?.description ?? "",
                note: prev?.note ?? "",
                categoryId: prev?.categoryId ?? 0,
              }));
            }}
          />
          <Input
            type="text"
            inputMode="decimal"
            label={t("labels.taxRateOptional")}
            value={ocrDraft?.mwstRate ?? ""}
            onChange={(event) => {
              const next = event.target.value;
              setOcrDraft((prev) => ({
                date: prev?.date ?? "",
                amount: prev?.amount ?? "",
                mwstRate: next,
                description: prev?.description ?? "",
                note: prev?.note ?? "",
                categoryId: prev?.categoryId ?? 0,
              }));
            }}
          />
          <Input
            label={t("labels.description")}
            value={ocrDraft?.description ?? ""}
            onChange={(event) => {
              const next = event.target.value;
              setOcrDraft((prev) => ({
                date: prev?.date ?? "",
                amount: prev?.amount ?? "",
                mwstRate: prev?.mwstRate ?? "",
                description: next,
                note: prev?.note ?? "",
                categoryId: prev?.categoryId ?? 0,
              }));
            }}
          />
          <Input
            label={t("labels.note")}
            value={ocrDraft?.note ?? ""}
            onChange={(event) => {
              const next = event.target.value;
              setOcrDraft((prev) => ({
                date: prev?.date ?? "",
                amount: prev?.amount ?? "",
                mwstRate: prev?.mwstRate ?? "",
                description: prev?.description ?? "",
                note: next,
                categoryId: prev?.categoryId ?? 0,
              }));
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOcrOpen(false)}>
              {t("actions.cancel")}
            </Button>
            <Button onClick={applyOcrSuggestion}>{t("actions.apply")}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmMissingReceipt}
        title={t("labels.receiptMissingTitle")}
        description={t("labels.receiptMissingBody")}
        confirmLabel={t("labels.duplicateSaveAnyway")}
        onConfirm={() => {
          if (!confirmMissingReceipt) return;
          submit(confirmMissingReceipt);
          setConfirmMissingReceipt(null);
        }}
        onCancel={() => setConfirmMissingReceipt(null)}
      />

      <ConfirmDialog
        open={!!duplicateState}
        title={t("labels.duplicateWarning")}
        description={duplicateState?.message ?? ""}
        confirmLabel={t("labels.duplicateSaveAnyway")}
        onConfirm={() => {
          if (!duplicateState) return;
          submit(duplicateState.data, true);
          setDuplicateState(null);
        }}
        onCancel={() => setDuplicateState(null)}
      />
    </div>
  );
}
