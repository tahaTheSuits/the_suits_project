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

// Local calendar date for filenames, e.g. "2026-11-25".
export const todayStamp = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Downloads a backend export (PDF/Excel) under an explicit filename.
export const downloadFile = async (path, filename, params) => {
  const res = await api.get(path, { responseType: "blob", params });
  saveAs(res.data, filename);
};

// Prefer the server's message (e.g. "Unit mismatch ...") over a generic one.
export const getErrorMessage = (err, fallback) => {
  if (err?.code === "ECONNABORTED") return `${fallback} (request timed out)`;
  const serverMessage = err?.response?.data?.message;
  return typeof serverMessage === "string" && serverMessage ? serverMessage : fallback;
};
