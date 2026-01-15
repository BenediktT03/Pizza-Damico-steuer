import * as React from "react";

import { cn } from "../../lib/utils";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "danger";
}

const variants = {
  default: "bg-app-surface text-app-primary border border-app-border",
  success: "bg-app-positive/15 text-app-positive border border-app-positive/30",
  warning: "bg-app-warning/15 text-app-warning border border-app-warning/30",
  danger: "bg-app-danger/15 text-app-danger border border-app-danger/30",
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
