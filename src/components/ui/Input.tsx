import * as React from "react";

import { cn } from "../../lib/utils";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, hint, error, ...props }, ref) => (
    <label className="flex w-full flex-col gap-1 text-sm">
      {label && <span className="text-xs font-medium text-app-neutral">{label}</span>}
      <input
        ref={ref}
        className={cn(
          "h-12 w-full rounded-xl border border-app-border bg-app-card px-3 text-base text-app-primary outline-none transition focus:border-app-accent focus:ring-2 focus:ring-app-accent/25 placeholder:text-app-neutral/70",
          error && "border-app-danger focus:border-app-danger focus:ring-app-danger/20",
          className
        )}
        {...props}
      />
      {hint && !error && <span className="text-xs text-app-neutral">{hint}</span>}
      {error && <span className="text-xs text-app-danger">{error}</span>}
    </label>
  )
);

Input.displayName = "Input";
