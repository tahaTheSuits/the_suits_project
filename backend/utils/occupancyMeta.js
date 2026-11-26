// Day metadata stored with each occupancy record (synced from the admin
// dashboard): Sunday / holiday flags, paused scheduled cleaning and the
// apartment-number breakdown behind the daily counts.
//
// Records written before these fields existed simply lack them; every read
// goes through normalizeMeta(), so they come back with the defaults below
// (false / null / 0 / []) instead of undefined.

class OccupancyError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const BREAKDOWN_KEYS = [
  "occupiedApartmentNumbers",
  "checkInApartmentNumbers",
  "checkOutApartmentNumbers",
  "servicedApartmentNumbers",
  "housekeepingApartmentNumbers",
  "laundryApartmentNumbers",
  "waterApartmentNumbers",
  "pausedServiceApartments",
];

const BOOLEAN_FIELDS = ["isSunday", "isHoliday", "noScheduledCleaning"];
const TEXT_FIELDS = { holidayName: 120, noServiceReason: 300 };
const META_FIELDS = [...BOOLEAN_FIELDS, ...Object.keys(TEXT_FIELDS), "pausedServiceApartments", "breakdown"];

const MAX_COUNT = 100000;
const MAX_APARTMENTS_PER_LIST = 5000;
const MAX_APARTMENT_LENGTH = 32;

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const emptyBreakdown = () => Object.fromEntries(BREAKDOWN_KEYS.map((k) => [k, []]));

const META_DEFAULTS = Object.freeze({
  isSunday: false,
  isHoliday: false,
  holidayName: null,
  noScheduledCleaning: false,
  noServiceReason: null,
  pausedServiceApartments: 0,
});

function readBoolean(field, raw) {
  if (raw === null || raw === undefined || raw === "") return false;
  if (raw === true || raw === "true" || raw === 1 || raw === "1") return true;
  if (raw === false || raw === "false" || raw === 0 || raw === "0") return false;
  throw new OccupancyError(`${field} must be true or false.`);
}

function readText(field, raw, max) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new OccupancyError(`${field} must be a string or null.`);
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length > max) throw new OccupancyError(`${field} must be at most ${max} characters.`);
  return text || null;
}

function readApartmentList(field, raw) {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) throw new OccupancyError(`breakdown.${field} must be an array of apartment numbers.`);
  if (raw.length > MAX_APARTMENTS_PER_LIST) {
    throw new OccupancyError(`breakdown.${field} may list at most ${MAX_APARTMENTS_PER_LIST} apartments.`);
  }
  const seen = new Set();
  const list = [];
  raw.forEach((value) => {
    if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) {
      throw new OccupancyError(`breakdown.${field} must contain apartment numbers (strings or numbers).`);
    }
    const apt = String(value).trim();
    if (!apt) return;
    if (apt.length > MAX_APARTMENT_LENGTH) {
      throw new OccupancyError(`Apartment "${apt.slice(0, 40)}" in breakdown.${field} is too long.`);
    }
    if (!seen.has(apt)) {
      seen.add(apt);
      list.push(apt);
    }
  });
  return list;
}

// Reads the metadata fields present in `input` (partial update semantics,
// like the counts): omitted -> unchanged, null -> back to the default.
// Inside `breakdown`, each list present replaces the stored list; breakdown
// null clears every list.
function readMeta(input) {
  const update = {};
  BOOLEAN_FIELDS.forEach((f) => {
    if (has(input, f)) update[f] = readBoolean(f, input[f]);
  });
  Object.entries(TEXT_FIELDS).forEach(([f, max]) => {
    if (has(input, f)) update[f] = readText(f, input[f], max);
  });
  if (has(input, "pausedServiceApartments")) {
    const raw = input.pausedServiceApartments;
    if (raw === null || raw === "") {
      update.pausedServiceApartments = 0;
    } else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > MAX_COUNT) {
        throw new OccupancyError(`pausedServiceApartments must be a whole number between 0 and ${MAX_COUNT}.`);
      }
      update.pausedServiceApartments = n;
    }
  }
  if (has(input, "breakdown")) {
    const raw = input.breakdown;
    if (raw === null) {
      update.breakdown = emptyBreakdown();
    } else if (typeof raw !== "object" || Array.isArray(raw)) {
      throw new OccupancyError("breakdown must be an object of apartment-number lists.");
    } else {
      update.breakdown = {};
      BREAKDOWN_KEYS.forEach((k) => {
        if (has(raw, k)) update.breakdown[k] = readApartmentList(k, raw[k]);
      });
    }
  }
  return update;
}

// Full metadata of a stored record (or of "no record"), with defaults for
// anything missing or malformed.
function normalizeMeta(record) {
  const r = record || {};
  const breakdown = emptyBreakdown();
  if (r.breakdown && typeof r.breakdown === "object") {
    BREAKDOWN_KEYS.forEach((k) => {
      if (Array.isArray(r.breakdown[k])) breakdown[k] = r.breakdown[k].map(String);
    });
  }
  const paused = Number(r.pausedServiceApartments);
  return {
    isSunday: r.isSunday === true,
    isHoliday: r.isHoliday === true,
    holidayName: typeof r.holidayName === "string" && r.holidayName.trim() ? r.holidayName : null,
    noScheduledCleaning: r.noScheduledCleaning === true,
    noServiceReason: typeof r.noServiceReason === "string" && r.noServiceReason.trim() ? r.noServiceReason : null,
    pausedServiceApartments: Number.isInteger(paused) && paused >= 0 ? paused : 0,
    breakdown,
  };
}

// Stored metadata + partial update -> complete metadata to write.
function mergeMeta(existing, update) {
  const merged = normalizeMeta(existing);
  Object.keys(META_DEFAULTS).forEach((f) => {
    if (has(update, f)) merged[f] = update[f];
  });
  if (update.breakdown) merged.breakdown = { ...merged.breakdown, ...update.breakdown };
  return merged;
}

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

function sameMeta(a, b) {
  const x = normalizeMeta(a);
  const y = normalizeMeta(b);
  return (
    Object.keys(META_DEFAULTS).every((f) => x[f] === y[f]) &&
    BREAKDOWN_KEYS.every((k) => sameList(x.breakdown[k], y.breakdown[k]))
  );
}

// "Holiday: Independence Day · no scheduled cleaning", "Sunday · no
// scheduled cleaning", "" for an ordinary day. Used by the exports.
function dayTypeText(meta) {
  const parts = [];
  if (meta.isHoliday) parts.push(meta.holidayName ? `Holiday: ${meta.holidayName}` : "Holiday");
  else if (meta.isSunday) parts.push("Sunday");
  if (meta.noScheduledCleaning) parts.push("no scheduled cleaning");
  const text = parts.join(" · ");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

module.exports = {
  OccupancyError,
  BREAKDOWN_KEYS,
  META_FIELDS,
  META_DEFAULTS,
  readMeta,
  normalizeMeta,
  mergeMeta,
  sameMeta,
  dayTypeText,
};
