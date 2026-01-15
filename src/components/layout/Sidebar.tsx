import { NavLink } from "react-router-dom";

import { useAppStore } from "../../state/appStore";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";

const navItems = [
  { labelKey: "nav.dashboard", shortKey: "nav.short.dashboard", to: "/" },
  { labelKey: "nav.income", shortKey: "nav.short.income", to: "/income" },
  { labelKey: "nav.expense", shortKey: "nav.short.expense", to: "/expense" },
  { labelKey: "nav.month", shortKey: "nav.short.month", to: "/month" },
  { labelKey: "nav.year", shortKey: "nav.short.year", to: "/year" },
  { labelKey: "nav.receipts", shortKey: "nav.short.receipts", to: "/receipts" },
  { labelKey: "nav.categories", shortKey: "nav.short.categories", to: "/categories" },
  { labelKey: "nav.export", shortKey: "nav.short.export", to: "/export" },
  { labelKey: "nav.audit", shortKey: "nav.short.audit", to: "/audit" },
  { labelKey: "nav.settings", shortKey: "nav.short.settings", to: "/settings" },
];

export function Sidebar() {
  const collapsed = useAppStore((state) => state.sidebarCollapsed);
  const { t } = useI18n();

  return (
    <aside
      data-tour="sidebar"
      className={cn(
        "hidden min-h-screen self-stretch flex-col border-r border-app-border bg-app-card transition-all duration-200 md:flex",
        collapsed ? "w-20" : "w-64"
      )}
    >
      <div className={cn("px-6 py-6", collapsed && "px-3")}>
        <div className={cn("flex items-center gap-3", collapsed && "justify-center")}>
          <img
            src="/brand/pizza-damico-logo.png"
            alt="Pizza D'Amico"
            className={cn("h-10 w-10 rounded-xl object-contain", collapsed && "h-8 w-8")}
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
          {!collapsed && (
            <div>
              <div className="text-lg font-semibold tracking-tight font-display">Pizza D'Amico</div>
              <div className="text-xs text-app-neutral">{t("app.subtitle")}</div>
            </div>
          )}
          {collapsed && <div className="text-sm font-semibold">PD</div>}
        </div>
      </div>
      <nav className={cn("flex-1 space-y-1", collapsed ? "px-2" : "px-3")}>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={t(item.labelKey)}
            data-tour={
              item.to === "/income"
                ? "nav-income"
                : item.to === "/export"
                ? "nav-export"
                : item.to === "/settings"
                ? "nav-settings"
                : undefined
            }
            className={({ isActive }) =>
              cn(
                "flex items-center rounded-lg px-3 py-2 text-sm text-app-neutral transition",
                collapsed && "justify-center px-2",
                isActive ? "bg-app-surface text-app-primary font-semibold" : "hover:bg-app-surface/70"
              )
            }
          >
            {collapsed ? (
              <span className="text-xs font-semibold tracking-wide">{t(item.shortKey)}</span>
            ) : (
              t(item.labelKey)
            )}
          </NavLink>
        ))}
      </nav>
      <div className={cn("px-6 py-4 text-xs text-app-neutral", collapsed && "px-2 text-center")}>
        {collapsed ? t("labels.offline") : t("nav.caption")}
      </div>
    </aside>
  );
}
