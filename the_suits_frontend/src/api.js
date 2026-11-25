import axios from "axios";

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

// Prefer the server's message (e.g. "Unit mismatch ...") over a generic one.
export const getErrorMessage = (err, fallback) => {
  if (err?.code === "ECONNABORTED") return `${fallback} (request timed out)`;
  const serverMessage = err?.response?.data?.message;
  return typeof serverMessage === "string" && serverMessage ? serverMessage : fallback;
};
