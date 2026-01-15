import { cn } from "../../lib/utils";

interface GuidanceCalloutProps {
  title: string;
  body: string;
  className?: string;
}

export function GuidanceCallout({ title, body, className }: GuidanceCalloutProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-app-accent/20 bg-app-surface/80 px-5 py-4 text-sm text-app-primary shadow-sm",
        className
      )}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-app-accent">{title}</div>
      <div className="mt-2 text-sm text-app-neutral">{body}</div>
    </div>
  );
}
