import * as React from "react";

import { cn } from "../../lib/utils";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, hint, error, onInput, rows, ...props }, ref) => {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
    const value = props.value;

    const resize = React.useCallback(() => {
      const element = innerRef.current;
      if (!element) return;
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
    }, []);

    React.useLayoutEffect(() => {
      resize();
    }, [resize, value]);

    const setRefs = (node: HTMLTextAreaElement | null) => {
      innerRef.current = node;
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
      }
    };

    return (
      <label className="flex w-full flex-col gap-1 text-sm">
        {label && <span className="text-xs font-medium text-app-neutral">{label}</span>}
        <textarea
          ref={setRefs}
          rows={rows ?? 3}
          onInput={(event) => {
            resize();
            onInput?.(event);
          }}
          className={cn(
            "w-full rounded-xl border border-app-border bg-app-card px-3 py-2 text-base text-app-primary outline-none transition focus:border-app-accent focus:ring-2 focus:ring-app-accent/25 placeholder:text-app-neutral/70 resize-none overflow-hidden",
            error && "border-app-danger focus:border-app-danger focus:ring-app-danger/20",
            className
          )}
          {...props}
        />
        {hint && !error && <span className="text-xs text-app-neutral">{hint}</span>}
        {error && <span className="text-xs text-app-danger">{error}</span>}
      </label>
    );
  }
);

Textarea.displayName = "Textarea";
