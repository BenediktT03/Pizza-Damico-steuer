import { create } from "zustand";

import { api } from "../lib/api";
import type { Settings } from "../lib/types";

type ThemeMode = "light" | "dark";
type Language = "de" | "it";
type DensityMode = "standard" | "comfort";
type OcrMode = "auto" | "offline" | "online";

interface AppStore {
  year: number;
  month: number;
  settings: Settings | null;
  globalSearch: string;
  sidebarCollapsed: boolean;
  theme: ThemeMode;
  language: Language;
  density: DensityMode;
  uiScale: number;
  ocrMode: OcrMode;
  ocrApiKey: string;
  setYear: (year: number) => void;
  setMonth: (month: number) => void;
  setSettings: (settings: Settings) => void;
  setGlobalSearch: (value: string) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setLanguage: (language: Language) => void;
  setDensity: (density: DensityMode) => void;
  setUiScale: (scale: number) => void;
  setOcrMode: (mode: OcrMode) => void;
  setOcrApiKey: (key: string) => void;
  hydrate: () => Promise<void>;
}

const getStoredTheme = (): ThemeMode => {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem("pd_theme");
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

const getStoredSidebar = () => {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem("pd_sidebar_collapsed") === "1";
};

const getStoredLanguage = (): Language => {
  if (typeof window === "undefined") return "de";
  const stored = window.localStorage.getItem("pd_language");
  if (stored === "de" || stored === "it") return stored;
  return "de";
};

const getStoredDensity = (): DensityMode => {
  if (typeof window === "undefined") return "standard";
  const stored = window.localStorage.getItem("pd_density");
  if (stored === "comfort" || stored === "standard") return stored;
  return "standard";
};

const getStoredUiScale = (): number => {
  if (typeof window === "undefined") return 100;
  const stored = Number(window.localStorage.getItem("pd_ui_scale"));
  if (Number.isFinite(stored) && stored >= 80 && stored <= 140) return stored;
  return 100;
};

const getStoredOcrMode = (): OcrMode => {
  if (typeof window === "undefined") return "auto";
  const stored = window.localStorage.getItem("pd_ocr_mode");
  if (stored === "auto" || stored === "offline" || stored === "online") return stored;
  return "auto";
};

const getStoredOcrKey = (): string => {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("pd_ocr_key") ?? "";
};

export const useAppStore = create<AppStore>((set, get) => ({
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  settings: null,
  globalSearch: "",
  sidebarCollapsed: false,
  theme: "light",
  language: "de",
  density: "standard",
  uiScale: 100,
  ocrMode: "auto",
  ocrApiKey: "",
  setYear: (year) => set({ year }),
  setMonth: (month) => set({ month }),
  setSettings: (settings) => set({ settings }),
  setGlobalSearch: (value) => set({ globalSearch: value }),
  setSidebarCollapsed: (collapsed) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("pd_sidebar_collapsed", collapsed ? "1" : "0");
    }
    set({ sidebarCollapsed: collapsed });
  },
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    if (typeof window !== "undefined") {
      window.localStorage.setItem("pd_sidebar_collapsed", next ? "1" : "0");
    }
    set({ sidebarCollapsed: next });
  },
  setTheme: (theme) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("pd_theme", theme);
    }
    set({ theme });
  },
  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    if (typeof window !== "undefined") {
      window.localStorage.setItem("pd_theme", next);
    }
    set({ theme: next });
  },
  setLanguage: (language) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("pd_language", language);
    }
    set({ language });
  },
  setDensity: (density) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("pd_density", density);
    }
    set({ density });
  },
  setUiScale: (scale) => {
    const next = Number.isFinite(scale) ? Math.min(140, Math.max(80, scale)) : 100;
    if (typeof window !== "undefined") {
      window.localStorage.setItem("pd_ui_scale", String(next));
    }
    set({ uiScale: next });
  },
  setOcrMode: (mode) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("pd_ocr_mode", mode);
    }
    set({ ocrMode: mode });
  },
  setOcrApiKey: (key) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("pd_ocr_key", key);
    }
    set({ ocrApiKey: key });
  },
  hydrate: async () => {
    const settings = await api.getSettings();
    set({
      settings,
      year: settings.current_year ?? get().year,
      theme: getStoredTheme(),
      sidebarCollapsed: getStoredSidebar(),
      language: getStoredLanguage(),
      density: getStoredDensity(),
      uiScale: getStoredUiScale(),
      ocrMode: getStoredOcrMode(),
      ocrApiKey: getStoredOcrKey(),
    });
  },
}));
