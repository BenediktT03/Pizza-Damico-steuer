import { useEffect } from "react";

import { cn } from "../../lib/utils";
import { useToastStore } from "../../state/toastStore";

const variantStyles = {
  default: "border-app-border",
  success: "border-emerald-500/30 bg-emerald-500/10",
  warning: "border-amber-500/30 bg-amber-500/10",
  danger: "border-rose-500/30 bg-rose-500/10",
};

export function ToastViewport() {
  const { toasts, removeToast } = useToastStore();

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((toast) =>
      setTimeout(() => removeToast(toast.id), 4000)
    );
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [toasts, removeToast]);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex w-80 flex-col gap-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "rounded-xl border bg-app-card px-4 py-3 shadow-lg",
            variantStyles[toast.variant ?? "default"]
          )}
        >
          <div className="text-sm font-semibold text-app-primary">{toast.title}</div>
          {toast.description && (
            <div className="text-xs text-app-neutral">{toast.description}</div>
          )}
        </div>
      ))}
    </div>
  );
}
