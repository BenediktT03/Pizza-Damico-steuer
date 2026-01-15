import { useEffect } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/layout/AppShell";
import { ToastViewport } from "./components/ui/Toast";
import { useAppStore } from "./state/appStore";
import { AuditLogPage } from "./pages/AuditLogPage";
import { CategoriesPage } from "./pages/CategoriesPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ExpensePage } from "./pages/ExpensePage";
import { ExportPage } from "./pages/ExportPage";
import { IncomePage } from "./pages/IncomePage";
import { MonthPage } from "./pages/MonthPage";
import { ReceiptsPage } from "./pages/ReceiptsPage";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { YearPage } from "./pages/YearPage";

export default function App() {
  const hydrate = useAppStore((state) => state.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <HashRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/income" element={<IncomePage />} />
          <Route path="/expense" element={<ExpensePage />} />
          <Route path="/month" element={<MonthPage />} />
          <Route path="/year" element={<YearPage />} />
          <Route path="/receipts" element={<ReceiptsPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="/audit" element={<AuditLogPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </AppShell>
      <ToastViewport />
    </HashRouter>
  );
}
