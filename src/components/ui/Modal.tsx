import * as React from "react";

import { cn } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function Modal({ open, onClose, title, children, className }: ModalProps) {
  const { t } = useI18n();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className={cn("w-full max-w-lg rounded-3xl bg-app-card shadow-2xl", className)}>
        <div className="flex items-center justify-between border-b border-app-border px-5 py-4">
          <h3 className="text-base font-semibold">{title}</h3>
          <button className="text-sm text-app-neutral" onClick={onClose} type="button">
            {t("actions.close")}
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
