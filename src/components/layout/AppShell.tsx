import * as React from "react";

import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { useI18n } from "../../lib/i18n";
import { useAppStore } from "../../state/appStore";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const theme = useAppStore((state) => state.theme);
  const language = useAppStore((state) => state.language);
  const density = useAppStore((state) => state.density);
  const uiScale = useAppStore((state) => state.uiScale);
  const { t } = useI18n();

  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  React.useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  React.useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  React.useEffect(() => {
    const baseSize = density === "comfort" ? 18 : 16;
    const scaled = baseSize * (uiScale / 100);
    document.documentElement.style.fontSize = `${scaled}px`;
  }, [density, uiScale]);

  return (
    <div className="min-h-screen bg-app-bg text-app-primary">
      <div className="flex">
        <Sidebar />
        <div className="flex min-h-screen flex-1 flex-col">
          <TopBar />
          <main className="flex-1 px-6 py-6">
            <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6">{children}</div>
          </main>
          <footer className="border-t border-app-border py-3 text-center text-xs text-app-neutral">
            {t("app.footer")}
          </footer>
        </div>
      </div>
    </div>
  );
}
