// Business-day helpers.
//
// A business day is a calendar date "YYYY-MM-DD" in the hotel's time zone.
// The time zone is the Node process time zone (set TZ, e.g. TZ=Asia/Riyadh,
// on the server). The existing daily/weekly reports already use the
// process's local time, so occupancy days and stock-out days always line up.
//
// Day keys are plain strings, so they never "slip" across UTC midnight.

const { ExportError } = require("./exportHelpers");

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

const businessTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

// "YYYY-MM-DD" (a real calendar date) -> same string, otherwise null.
function parseDayKey(value) {
  if (typeof value !== "string") return null;
  const match = DAY_KEY.exec(value.trim());
  if (!match) return null;
  const [y, m, d] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return value.trim();
}

// Business day of an instant.
function dayKeyOf(date, timeZone = businessTimeZone()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const todayKey = () => dayKeyOf(new Date());

const keyToUtc = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

function addDays(key, days) {
  return new Date(keyToUtc(key) + days * DAY_MS).toISOString().slice(0, 10);
}

function listDays(from, to) {
  const days = [];
  for (let key = from; key <= to; key = addDays(key, 1)) days.push(key);
  return days;
}

// A UTC window that safely contains every instant of the business days
// [from, to] for any time zone (UTC-14..UTC+14). Queries use it with the
// date index, then keep only rows whose exact business day is in range.
function paddedUtcWindow(from, to) {
  return {
    start: new Date(keyToUtc(from) - DAY_MS),
    end: new Date(keyToUtc(to) + 2 * DAY_MS),
  };
}

const gbDay = (key) => key.split("-").reverse().join("/");

// ?from=&to= for day-based reports. Defaults to the last 7 business days
// (ending today). Both bounds inclusive; at most `maxDays` days.
function resolveDayRange(query = {}, { defaultDays = 7, maxDays = 366 } = {}) {
  const rawFrom = query.from || "";
  const rawTo = query.to || "";
  const from = rawFrom ? parseDayKey(rawFrom) : null;
  const to = rawTo ? parseDayKey(rawTo) : null;
  if (rawFrom && !from) throw new ExportError(400, `Invalid from date "${rawFrom}". Use YYYY-MM-DD.`);
  if (rawTo && !to) throw new ExportError(400, `Invalid to date "${rawTo}". Use YYYY-MM-DD.`);

  const end = to || todayKey();
  const start = from || addDays(end, -(defaultDays - 1));
  if (start > end) throw new ExportError(400, "The from date must be on or before the to date.");

  const days = listDays(start, end);
  if (days.length > maxDays) {
    throw new ExportError(400, `Choose a period of at most ${maxDays} days.`);
  }
  return {
    from: start,
    to: end,
    days,
    label: start === end ? gbDay(start) : `${gbDay(start)} – ${gbDay(end)}`,
    slug: start === end ? start : `${start}_to_${end}`,
  };
}

module.exports = {
  businessTimeZone,
  parseDayKey,
  dayKeyOf,
  todayKey,
  addDays,
  listDays,
  paddedUtcWindow,
  gbDay,
  resolveDayRange,
};
