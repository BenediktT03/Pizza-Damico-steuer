import { createWorker } from "tesseract.js";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { parseDecimalInput } from "./parse";

GlobalWorkerOptions.workerSrc = pdfWorker;

export type OcrMode = "auto" | "offline" | "online";

export type OcrMethod = "offline" | "online";

export interface OcrSource {
  dataBase64: string;
  contentType: string;
}

export interface OcrRunOptions {
  mode: OcrMode;
  apiKey?: string | null;
  uiLanguage?: "de" | "it";
  onProgress?: (progress: number, status: string) => void;
}

export interface OcrResult {
  text: string;
  method: OcrMethod;
}

export interface OcrSuggestion {
  date?: string;
  amount?: number;
  mwstRate?: number;
  description?: string;
  note?: string;
}

const OCR_LANG = "deu+ita+eng";
const OCR_LANG_PATH = "/ocr";
const OCR_CORE_PATH = "/ocr-core";

export async function runReceiptOcr(source: OcrSource, options: OcrRunOptions): Promise<OcrResult> {
  const mode = options.mode;
  const wantsOnline = mode === "online" || (mode === "auto" && !!options.apiKey && navigator.onLine);

  if (wantsOnline) {
    try {
      const text = await runOnlineOcr(source, options);
      return { text, method: "online" };
    } catch (error) {
      if (mode === "online") {
        throw error;
      }
    }
  }

  const text = await runOfflineOcr(source, options);
  return { text, method: "offline" };
}

export function parseReceiptText(text: string): OcrSuggestion {
  const lines = text
    .split(/\r?\n/)
    .map((line) => normalizeOcrLine(line))
    .filter((line) => line.length > 0);

  const description = lines.find((line) => isTextLine(line) && !isNoiseLine(line));
  const items = extractItems(lines);
  const note = items.length > 0 ? items.join(", ") : undefined;

  const date = findDate(lines);
  const amount = findAmount(lines);
  const mwstRate = findMwstRate(lines);

  return {
    date: date ?? undefined,
    amount: amount ?? undefined,
    mwstRate: mwstRate ?? undefined,
    description: description ?? (items[0] ?? undefined),
    note,
  };
}

function isTextLine(line: string): boolean {
  return /[\p{L}]/u.test(line) && line.length > 3;
}

function normalizeOcrLine(line: string): string {
  return line.replace(/[|]+/g, " ").replace(/\s+/g, " ").replace(/[.,;:]+$/, "").trim();
}

function isNoiseLine(line: string): boolean {
  const lower = line.toLowerCase();
  const noiseKeywords = [
    "total",
    "summe",
    "gesamt",
    "betrag",
    "zu zahlen",
    "da pagare",
    "importo",
    "mwst",
    "ust",
    "vat",
    "iva",
  ];
  return noiseKeywords.some((keyword) => lower.includes(keyword));
}

const AMOUNT_PATTERN = /(\d{1,3}(?:[\s'.]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2})/;
const PRICE_ONLY_PATTERN = /^\s*(?:chf|fr|eur)?\s*(\d{1,3}(?:[\s'.]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2})\s*(?:chf|fr|eur)?\s*[a-z]?\s*[.,;:]?\s*$/i;
const TRAILING_PRICE_PATTERN = /[-–]?\s*(?:chf|fr|eur)?\s*(\d{1,3}(?:[\s'.]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2})\s*(?:chf|fr|eur)?\s*[a-z]?\s*[.,;:]?\s*$/i;

function isPriceOnlyLine(line: string): boolean {
  return PRICE_ONLY_PATTERN.test(line);
}

function stripTrailingPrice(line: string): string {
  return line.replace(TRAILING_PRICE_PATTERN, "").trim();
}

function looksLikeItemLine(line: string): boolean {
  if (!isTextLine(line) || isNoiseLine(line)) return false;
  const letters = line.match(/\p{L}/gu);
  if (!letters || letters.length < 2) return false;
  const digits = line.match(/\d/g);
  if (digits && digits.length > letters.length * 2) return false;
  if (/(tel|fax|www|http|@)/i.test(line)) return false;
  return true;
}

function extractItems(lines: string[]): string[] {
  const items: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = normalizeOcrLine(lines[index]);
    if (isNoiseLine(line) || isPriceOnlyLine(line)) continue;

    const hasAmount = AMOUNT_PATTERN.test(line);
    if (hasAmount) {
      const cleaned = stripTrailingPrice(line);
      if (cleaned.length >= 3 && looksLikeItemLine(cleaned)) {
        items.push(cleaned);
        if (items.length >= 6) break;
      }
      continue;
    }

    if (!looksLikeItemLine(line)) continue;
    const next = lines[index + 1] ? normalizeOcrLine(lines[index + 1]) : "";
    if (next && isPriceOnlyLine(next)) {
      items.push(line);
      index += 1;
      if (items.length >= 6) break;
    }
  }

  if (items.length === 0) {
    for (const line of lines) {
      if (isPriceOnlyLine(line) || !looksLikeItemLine(line)) continue;
      items.push(line);
      if (items.length >= 4) break;
    }
  }
  return items;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getImageDataUrl(source: OcrSource): Promise<string> {
  if (source.contentType === "application/pdf") {
    const pdfData = base64ToUint8Array(source.dataBase64);
    const loadingTask = getDocument({ data: pdfData });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas nicht verfuegbar");
    }
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: ctx, canvas, viewport }).promise;
    return canvas.toDataURL("image/png");
  }
  return `data:${source.contentType};base64,${source.dataBase64}`;
}

async function runOfflineOcr(source: OcrSource, options: OcrRunOptions): Promise<string> {
  const image = await getImageDataUrl(source);
  const worker = await createWorker(OCR_LANG, undefined, {
    langPath: OCR_LANG_PATH,
    corePath: OCR_CORE_PATH,
    workerPath: new URL("tesseract.js/dist/worker.min.js", import.meta.url).toString(),
    logger: (message) => {
      if (options.onProgress) {
        options.onProgress(message.progress ?? 0, message.status ?? "OCR");
      }
    },
  });
  const result = await worker.recognize(image);
  await worker.terminate();
  return result.data.text ?? "";
}

async function runOnlineOcr(source: OcrSource, options: OcrRunOptions): Promise<string> {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    throw new Error("Kein API-Schluessel fuer Online-OCR");
  }

  const language = options.uiLanguage === "it" ? "ita" : "ger";
  const payload = new URLSearchParams();
  payload.append("apikey", apiKey);
  payload.append("language", language);
  payload.append("isOverlayRequired", "false");
  payload.append("OCREngine", "2");
  payload.append("base64Image", `data:${source.contentType};base64,${source.dataBase64}`);

  const response = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    body: payload,
  });
  if (!response.ok) {
    throw new Error("Online-OCR fehlgeschlagen");
  }
  const data = (await response.json()) as {
    ParsedResults?: Array<{ ParsedText?: string }>;
    IsErroredOnProcessing?: boolean;
    ErrorMessage?: string | string[];
  };
  if (data.IsErroredOnProcessing) {
    const message = Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join(", ") : data.ErrorMessage;
    throw new Error(message || "Online-OCR Fehler");
  }
  const parsed = data.ParsedResults?.[0]?.ParsedText ?? "";
  return parsed;
}

function findDate(lines: string[]): string | null {
  const patterns = [
    /(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/,
    /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/,
  ];
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        if (pattern === patterns[0]) {
          const day = Number(match[1]);
          const month = Number(match[2]);
          let year = Number(match[3]);
          if (year < 100) {
            year += year >= 70 ? 1900 : 2000;
          }
          return toIsoDate(year, month, day);
        }
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        return toIsoDate(year, month, day);
      }
    }
  }
  return null;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (!year || !month || !day) return null;
  const safeMonth = String(month).padStart(2, "0");
  const safeDay = String(day).padStart(2, "0");
  return `${year}-${safeMonth}-${safeDay}`;
}

function findAmount(lines: string[]): number | null {
  const keywords = ["total", "summe", "gesamt", "betrag", "totale", "importo", "da pagare", "zu zahlen"];
  const candidates: { value: number; score: number }[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    const hasKeyword = keywords.some((keyword) => lower.includes(keyword));
    const hasChf = lower.includes("chf") || lower.includes("fr");
    const amounts = line.match(/(\d{1,3}(?:[\s'.]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2})/g);
    if (!amounts) continue;
    for (const raw of amounts) {
      const parsed = parseDecimalInput(raw);
      if (!parsed || parsed <= 0) continue;
      let score = parsed;
      if (hasKeyword) score += 1000;
      if (hasChf) score += 500;
      candidates.push({ value: parsed, score });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].value;
}

function findMwstRate(lines: string[]): number | null {
  const keywordPattern = /(mwst|ust|vat|iva)/i;
  const percentPattern = /(\d{1,2}(?:[.,]\d)?)\s*%/;

  for (const line of lines) {
    if (!keywordPattern.test(line)) continue;
    const match = line.match(percentPattern);
    if (!match) continue;
    const parsed = parseDecimalInput(match[1]);
    if (parsed === undefined) continue;
    return parsed;
  }
  return null;
}
