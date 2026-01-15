import { Button } from "./Button";
import { Modal } from "./Modal";
import { useI18n } from "../../lib/i18n";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const resolvedConfirm = confirmLabel ?? t("actions.confirm");
  const resolvedCancel = cancelLabel ?? t("actions.cancel");

  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <div className="space-y-4 text-sm text-app-neutral">
        <p>{description}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {resolvedCancel}
          </Button>
          <Button onClick={onConfirm}>{resolvedConfirm}</Button>
        </div>
      </div>
    </Modal>
  );
}
