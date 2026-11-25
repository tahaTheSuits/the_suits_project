// POST /api/occupancy/pull-dashboard
// body (or query): { from?: "YYYY-MM-DD", to?: "YYYY-MM-DD", force?: boolean }
//
// Pulls daily occupancy/service data from the-suites-admin-dashboard
// (see utils/dashboardClient.js) and applies it through the same upsert
// pipeline as POST /api/occupancy/sync: one record per date, idempotent,
// stale updatedAt skipped, manual overrides respected unless force=true.
// Defaults to the last 7 business days; at most 366 days per pull.
const { DashboardError, fetchDashboardDays, mapDashboardDay } = require("../utils/dashboardClient");
const { applySyncRecords, summarizeResults, OccupancyError, MAX_SYNC_RECORDS } = require("./occupancyController");
const { ExportError } = require("../utils/exportHelpers");
const { parseDayKey, resolveDayRange, businessTimeZone } = require("../utils/businessDay");

// One pull at a time per API process (prevents double clicks / overlapping
// runs from hammering the dashboard or racing each other).
let pullInProgress = false;

const STATUS_TEXT = {
  created: "created",
  updated: "updated",
  unchanged: "unchanged",
  skipped_manual_override: "skipped (manual override)",
  skipped_stale: "skipped (older than stored)",
  invalid: "invalid",
};

const describe = (summary, fetched) => {
  if (fetched === 0) return "The dashboard returned no days for this period.";
  const parts = Object.keys(STATUS_TEXT)
    .filter((k) => summary[k])
    .map((k) => `${summary[k]} ${STATUS_TEXT[k]}`);
  return `Fetched ${fetched} day${fetched === 1 ? "" : "s"} from the dashboard: ${parts.join(", ")}.`;
};

const readForce = (value) => value === true || value === "true" || value === 1 || value === "1";

exports.pullFromDashboard = async (req, res) => {
  const input = { ...(req.query || {}), ...(req.body || {}) };

  let range;
  try {
    range = resolveDayRange({ from: input.from, to: input.to }, { defaultDays: 7, maxDays: MAX_SYNC_RECORDS });
  } catch (err) {
    if (err instanceof ExportError) return res.status(err.status).json({ message: err.message, code: "invalid_range" });
    throw err;
  }
  const force = readForce(input.force);

  if (pullInProgress) {
    return res.status(409).json({ message: "A dashboard sync is already running. Try again in a moment.", code: "sync_in_progress" });
  }
  pullInProgress = true;

  try {
    const { days } = await fetchDashboardDays({ from: range.from, to: range.to });

    const results = [];
    const records = [];
    const seen = new Set();
    days.forEach((day) => {
      const record = mapDashboardDay(day);
      const date = parseDayKey(record.date);
      if (!date) {
        results.push({ date: record.date ?? null, status: "invalid", message: "Missing or invalid date (expected YYYY-MM-DD)." });
      } else if (date < range.from || date > range.to) {
        results.push({ date, status: "invalid", message: `Outside the requested range ${range.from}..${range.to}.` });
      } else if (seen.has(date)) {
        results.push({ date, status: "invalid", message: "Date appears more than once in the dashboard response." });
      } else {
        seen.add(date);
        records.push({ ...record, date });
      }
    });

    if (records.length) {
      const applied = await applySyncRecords(records, { force });
      results.push(...applied.results);
    }
    results.sort((a, b) => String(a.date).localeCompare(String(b.date)));

    const summary = summarizeResults(results);
    res.json({
      message: describe(summary, days.length),
      from: range.from,
      to: range.to,
      timeZone: businessTimeZone(),
      force,
      fetchedDays: days.length,
      summary,
      results,
      // Days in the range the dashboard did not send (left unchanged).
      missingDays: range.days.filter((d) => !seen.has(d)),
    });
  } catch (err) {
    if (err instanceof DashboardError) {
      console.warn(`[dashboard-sync] ${err.code}: ${err.message}`);
      return res.status(err.status).json({ message: err.message, code: err.code });
    }
    if (err instanceof OccupancyError) {
      return res.status(err.status).json({ message: err.message, code: "invalid_records" });
    }
    console.error("[dashboard-sync] failed:", err);
    res.status(500).json({ message: "Dashboard sync failed unexpectedly.", code: "internal_error" });
  } finally {
    pullInProgress = false;
  }
};
