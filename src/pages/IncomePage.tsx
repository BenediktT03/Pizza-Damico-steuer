import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { api, parseInvokeError } from "../lib/api";
import { formatIsoDate } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { parseDecimalInput } from "../lib/parse";
import { useToastStore } from "../state/toastStore";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";

type FormInput = {
  date: string;
  payment_method: "BAR" | "TWINT";
  amount_chf: string | number;
  mwst_rate: string | number;
  note?: string;
};

type FormValues = {
  date: string;
  payment_method: "BAR" | "TWINT";
  amount_chf: number;
  mwst_rate: number;
  note?: string;
};

export function IncomePage() {
  const { t } = useI18n();
  const addToast = useToastStore((state) => state.addToast);
  const [keepValues, setKeepValues] = useState(false);
  const [duplicateState, setDuplicateState] = useState<{ message: string; data: FormValues } | null>(null);

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

  const schema = useMemo(
    () =>
      z.object({
        date: z.string().min(1, t("errors.dateRequired")),
        payment_method: z.enum(["BAR", "TWINT"], t("errors.paymentRequired")),
        amount_chf: z.preprocess(parseDecimalInput, z.number().positive(t("errors.amountPositive"))),
        mwst_rate: z.preprocess(parseDecimalInput, z.number().min(0).max(99.9, t("errors.taxRateRange"))),
        note: z.string().optional(),
      }),
    [t]
  );

  const defaultValues = useMemo<FormInput>(
    () => ({
      date: formatIsoDate(new Date()),
      payment_method: "BAR",
      amount_chf: "",
      mwst_rate: "0",
      note: "",
    }),
    []
  );

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormInput>({
    resolver: zodResolver(schema),
    defaultValues,
  });

  const mwstValue = useWatch({ control, name: "mwst_rate" });
  const mwstSelectValue = mwstOptions.some((opt) => opt.value === String(mwstValue)) ? String(mwstValue) : "";

  const submit = async (values: FormValues, allowDuplicate?: boolean) => {
    try {
      const tx = await api.createIncome({
        ...values,
        allow_duplicate: allowDuplicate,
      });
      addToast({
        title: `${t("labels.save")}: ID ${tx.public_id}`,
        variant: "success",
      });
      if (!keepValues) {
        reset(defaultValues);
      }
    } catch (error) {
      const parsed = parseInvokeError(error);
      if (parsed.code === "DUPLICATE_WARNING") {
        setDuplicateState({ message: parsed.message, data: values });
        return;
      }
      addToast({
        title: t("labels.incomeSaveFailed"),
        description: parsed.message,
        variant: "danger",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("labels.incomeTitle")}</h1>
        <p className="page-subtitle">{t("labels.incomeSubtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t("labels.incomeFormTitle")}</CardTitle>
            <p className="text-xs text-app-neutral">{t("labels.incomeFormHint")}</p>
          </div>
        </CardHeader>
        <CardBody>
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={handleSubmit(
              (values) => {
                const parsed = schema.parse(values);
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
            <Select label={t("labels.paymentMethod")} error={errors.payment_method?.message} {...register("payment_method")}>
              <option value="BAR">{t("labels.paymentBar")}</option>
              <option value="TWINT">{t("labels.paymentTwint")}</option>
            </Select>
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
              label={t("labels.taxRate")}
              placeholder="0.0"
              error={errors.mwst_rate?.message}
              {...register("mwst_rate")}
            />
            <Select
              label={t("labels.taxRateStandard")}
              value={mwstSelectValue}
              onChange={(event) => setValue("mwst_rate", event.target.value)}
            >
              <option value="">{t("labels.manual")}</option>
              {mwstOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Input label={t("labels.note")} {...register("note")} />
            <div className="flex items-center gap-2">
              <input
                id="keepValues"
                type="checkbox"
                className="h-4 w-4 rounded border-app-border"
                checked={keepValues}
                onChange={(event) => setKeepValues(event.target.checked)}
              />
              <label htmlFor="keepValues" className="text-xs text-app-neutral">
                {t("labels.keepValues")}
              </label>
            </div>
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" disabled={isSubmitting}>
                {t("labels.save")}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

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
