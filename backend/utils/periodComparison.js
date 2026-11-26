// Period-over-period consumption comparison.
//
// The previous period has the same length and ends the day before the
// selected one starts:
//   7 days 2026-11-08..14        -> 2026-11-01..07
//   full calendar month(s)        -> the same number of calendar months
//   2026-11-01..30                -> 2026-10-01..31
// Stock out uses corrected (effective) quantities per business day, in each
// product's own unit (never summed across units).
const StockOut = require("../models/stockOutModel");
const { latestCorrectionLookup, EFFECTIVE_QUANTITY } = require("./stock");
const { addDays, listDays, paddedUtcWindow, gbDay } = require("./businessDay");

// Increase at or above this percentage is shown as significant (red).
const SIGNIFICANT_INCREASE_PCT = 25;

const pad = (n) => String(n).padStart(2, "0");
const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1-12
const parts = (key) => key.split("-").map(Number);

function isFullMonths(from, to) {
  const [, , fd] = parts(from);
  const [ty, tm, td] = parts(to);
  return fd === 1 && td === lastDayOfMonth(ty, tm);
}

function previousPeriodOf(from, to) {
  const days = listDays(from, to).length;
  if (isFullMonths(from, to)) {
    const [fy, fm] = parts(from);
    const [ty, tm] = parts(to);
    const months = (ty - fy) * 12 + (tm - fm) + 1;
    // First day of the month `months` before `from`.
    const startIndex = fy * 12 + (fm - 1) - months;
    const sy = Math.floor(startIndex / 12);
    const sm = (startIndex % 12) + 1;
    const prevFrom = `${sy}-${pad(sm)}-01`;
    const prevTo = addDays(from, -1);
    return { from: prevFrom, to: prevTo, kind: "months", months, days: listDays(prevFrom, prevTo).length };
  }
  return { from: addDays(from, -days), to: addDays(from, -1), kind: "days", days };
}

const round = (n, digits = 3) => Math.round(n * 10 ** digits) / 10 ** digits;

// { pct, label, trend }: trend "down" (less used), "same", "up", "high"
// (>= SIGNIFICANT_INCREASE_PCT), "new" (nothing used before).
function changeOf(current, previous) {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (prev === 0 && cur === 0) return { pct: 0, label: "0%", trend: "same" };
  if (prev === 0) return { pct: null, label: "New", trend: "new" };
  const pct = round(((cur - prev) / prev) * 100, 1);
  return {
    pct,
    label: `${pct > 0 ? "+" : ""}${pct}%`,
    trend: pct < 0 ? "down" : pct === 0 ? "same" : pct >= SIGNIFICANT_INCREASE_PCT ? "high" : "up",
  };
}

// Map productId -> effective stock out in [from, to] (business days).
async function stockOutByProduct({ from, to }, timeZone) {
  const window = paddedUtcWindow(from, to);
  const rows = await StockOut.aggregate([
    { $match: { date: { $gte: window.start, $lt: window.end } } },
    { $addFields: { businessDay: { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: timeZone } } } },
    { $match: { businessDay: { $gte: from, $lte: to } } },
    latestCorrectionLookup("out"),
    { $group: { _id: "$product", quantity: { $sum: EFFECTIVE_QUANTITY } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), round(r.quantity)]));
}

const periodLabel = ({ from, to }) => (from === to ? gbDay(from) : `${gbDay(from)} – ${gbDay(to)}`);

module.exports = {
  SIGNIFICANT_INCREASE_PCT,
  previousPeriodOf,
  changeOf,
  stockOutByProduct,
  periodLabel,
};
