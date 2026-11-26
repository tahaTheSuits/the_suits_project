// Client for the-suites-admin-dashboard's warehouse integration endpoint:
//
//   GET {DASHBOARD_API_URL}/api/integrations/warehouse/daily?from=YYYY-MM-DD&to=YYYY-MM-DD
//   -> { days: [ { date, totalApartments, occupiedApartments, ..., isSunday,
//                  isHoliday, holidayName, noScheduledCleaning, noServiceReason,
//                  pausedServiceApartments, breakdown: { ... }, updatedAt } ] }
//
// Environment:
//   DASHBOARD_API_URL     base URL of the dashboard API (trailing slashes ok)
//   DASHBOARD_API_KEY     API key for the dashboard (preferred). Fallbacks, in
//                         order: WAREHOUSE_API_KEY, OCCUPANCY_SYNC_TOKEN
//   DASHBOARD_TIMEOUT_MS  request timeout, default 15000
//
// The key is sent as both "X-Api-Key: <key>" and "Authorization: Bearer <key>"
// and is never logged or returned to clients.

const DEFAULT_TIMEOUT_MS = 15000;
const DAILY_PATH = "/api/integrations/warehouse/daily";
const KEY_VARS = ["DASHBOARD_API_KEY", "WAREHOUSE_API_KEY", "OCCUPANCY_SYNC_TOKEN"];
const { META_FIELDS } = require("./occupancyMeta");

// Fields copied from the dashboard into the Occupancy sync pipeline.
const MAPPED_FIELDS = [
  "totalApartments",
  "occupiedApartments",
  "vacantApartments",
  "checkIns",
  "checkOuts",
  "servicedApartments",
  "housekeepingCount",
  "laundryCount",
  "waterCount",
  // Day metadata + apartment-number breakdown (utils/occupancyMeta.js).
  ...META_FIELDS,
];

class DashboardError extends Error {
  // status: HTTP status this API answers with; code: stable machine code.
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function readConfig(env = process.env) {
  const rawUrl = (env.DASHBOARD_API_URL || "").trim();
  if (!rawUrl) {
    throw new DashboardError(
      503,
      "dashboard_not_configured",
      "Dashboard sync is not configured: set DASHBOARD_API_URL on the warehouse API.",
    );
  }
  let base;
  try {
    base = new URL(rawUrl);
  } catch {
    throw new DashboardError(503, "dashboard_not_configured", "DASHBOARD_API_URL is not a valid URL.");
  }
  if (!["http:", "https:"].includes(base.protocol)) {
    throw new DashboardError(503, "dashboard_not_configured", "DASHBOARD_API_URL must start with http:// or https://.");
  }

  const keyVar = KEY_VARS.find((name) => (env[name] || "").trim());
  if (!keyVar) {
    throw new DashboardError(
      503,
      "dashboard_key_missing",
      "Dashboard API key is missing: set DASHBOARD_API_KEY (or WAREHOUSE_API_KEY / OCCUPANCY_SYNC_TOKEN).",
    );
  }

  const timeout = Number(env.DASHBOARD_TIMEOUT_MS);
  return {
    // Trailing slashes removed so the path is joined with exactly one "/".
    baseUrl: `${base.origin}${base.pathname.replace(/\/+$/, "")}`,
    apiKey: env[keyVar].trim(),
    keyVar,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

function buildDailyUrl(baseUrl, from, to) {
  const query = new URLSearchParams({ from, to });
  return `${baseUrl}${DAILY_PATH}?${query}`;
}

const shortText = (text) => String(text || "").replace(/\s+/g, " ").trim().slice(0, 200);

// Fetches days [from, to] from the dashboard. Returns { url, days }.
async function fetchDashboardDays({ from, to }, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = readConfig(env);
  const url = buildDailyUrl(config.baseUrl, from, to);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Api-Key": config.apiKey,
        Authorization: `Bearer ${config.apiKey}`,
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new DashboardError(504, "dashboard_timeout", `The dashboard did not answer within ${config.timeoutMs / 1000}s.`, { url });
    }
    throw new DashboardError(
      502,
      "dashboard_unreachable",
      `Could not reach the dashboard at ${config.baseUrl} (${err?.cause?.code || err?.code || err?.message || "network error"}).`,
      { url },
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text().catch(() => "");
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (response.status === 401 || response.status === 403) {
    throw new DashboardError(
      502,
      "dashboard_auth_failed",
      `The dashboard rejected the API key (${response.status}). Check ${config.keyVar} on the warehouse API.`,
      { url, dashboardStatus: response.status },
    );
  }
  if (!response.ok) {
    const detail = shortText(body?.message || body?.error || text);
    throw new DashboardError(
      502,
      "dashboard_error",
      `The dashboard returned an error (${response.status})${detail ? `: ${detail}` : ""}.`,
      { url, dashboardStatus: response.status },
    );
  }
  if (!body || !Array.isArray(body.days)) {
    throw new DashboardError(
      502,
      "dashboard_bad_response",
      "The dashboard response was not valid JSON with a days[] array.",
      { url },
    );
  }
  return { url, days: body.days };
}

// Maps one dashboard day to a sync record. Only known fields are copied;
// fields the dashboard omits stay unchanged in the warehouse (null clears).
function mapDashboardDay(day) {
  if (!day || typeof day !== "object") return { date: null };
  const record = { date: typeof day.date === "string" ? day.date.trim() : day.date };
  MAPPED_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(day, field)) record[field] = day[field];
  });
  if (day.updatedAt !== undefined && day.updatedAt !== null && day.updatedAt !== "") {
    record.updatedAt = day.updatedAt;
  }
  return record;
}

module.exports = {
  DashboardError,
  readConfig,
  buildDailyUrl,
  fetchDashboardDays,
  mapDashboardDay,
  KEY_VARS,
  DAILY_PATH,
};
