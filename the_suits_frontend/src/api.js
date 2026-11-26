import axios from "axios";
import { saveAs } from "file-saver";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://the-suits-project.onrender.com";

// Shared client for the whole app (previously created twice).
// The timeout is generous because the hosted API can take a while to wake up.
export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 45000,
});

export const UNITS = ["pcs", "gallon", "bag"];

export const isCanceled = (err) => axios.isCancel(err) || err?.code === "ERR_CANCELED";

// Idempotency key for one intended submission (e.g. one stock out).
export const newRequestId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

// GET /api/products/by-barcode/:code -> active product row (with stock).
// Barcodes are trimmed only; leading zeros and symbols are preserved.
export const lookupBarcode = async (code, config) => {
  const res = await api.get(`/api/products/by-barcode/${encodeURIComponent(code.trim())}`, config);
  return res.data.product;
};

// Camera scanning uses the browser's BarcodeDetector API (no library).
export const cameraScanSupported = () =>
  typeof window !== "undefined" &&
  "BarcodeDetector" in window &&
  Boolean(navigator.mediaDevices?.getUserMedia);

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// the-suites-admin-dashboard frontend, e.g. "https://dashboard.example.com"
// (-> /?date=YYYY-MM-DD) or ".../dashboard" (-> /dashboard?date=YYYY-MM-DD).
// No URL is guessed: when VITE_DASHBOARD_URL is not set, the links are
// shown disabled with a hint instead of pointing somewhere wrong.
const DASHBOARD_URL = (import.meta.env.VITE_DASHBOARD_URL || "").trim();

export const dashboardDayUrl = (date) => {
  if (!DASHBOARD_URL || !date) return null;
  try {
    const url = new URL(DASHBOARD_URL);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.searchParams.set("date", date);
    return url.toString();
  } catch {
    return null;
  }
};

export const DASHBOARD_NOT_CONFIGURED = "Set VITE_DASHBOARD_URL to link to the admin dashboard";

// Local calendar date for filenames, e.g. "2026-11-25".
export const todayStamp = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Filename suffix for an export period; mirrors the backend so the fallback
// name matches the server's (e.g. "2026-11-01_to_2026-11-25", "all-dates").
export const rangeSlug = (from, to) => {
  if (from && to) return from === to ? from : `${from}_to_${to}`;
  if (from) return `${from}_to_${todayStamp()}`;
  if (to) return `until_${to}`;
  return "all-dates";
};

const filenameFromHeaders = (headers) => {
  const disposition = headers?.["content-disposition"] || "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return match ? decodeURIComponent(match[1]) : null;
};

// Downloads a backend export (PDF/Excel). Uses the server's filename when
// the browser can read it, otherwise `fallbackFilename`. Error responses
// arrive as Blobs; they are parsed back to JSON so the server's message
// (e.g. "Invalid from date") can be shown instead of a generic failure.
export const downloadFile = async (path, fallbackFilename, params) => {
  let res;
  try {
    res = await api.get(path, { responseType: "blob", params });
  } catch (err) {
    const data = err?.response?.data;
    if (data instanceof Blob) {
      try {
        err.response.data = JSON.parse(await data.text());
      } catch {
        err.response.data = {};
      }
    }
    throw err;
  }
  saveAs(res.data, filenameFromHeaders(res.headers) || fallbackFilename);
};

// Prefer the server's message (e.g. "Unit mismatch ...") over a generic one.
export const getErrorMessage = (err, fallback) => {
  if (err?.code === "ECONNABORTED") return `${fallback} (request timed out)`;
  const serverMessage = err?.response?.data?.message;
  return typeof serverMessage === "string" && serverMessage ? serverMessage : fallback;
};
