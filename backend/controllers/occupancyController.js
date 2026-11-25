// Daily occupancy & housekeeping records (one per business day).
//
//   GET  /api/occupancy?from=&to=     list days (default: last 31 days)
//   GET  /api/occupancy/:date         one day
//   PUT  /api/occupancy/:date         manual entry / edit (upsert, merge)
//   POST /api/occupancy/sync          idempotent bulk upsert from the
//                                     admin dashboard (optional token)
//
// Nothing here deletes records. Unknown counts are stored as null, never 0.
const crypto = require("crypto");
const Occupancy = require("../models/occupancyModel");
const { ExportError } = require("../utils/exportHelpers");
const { parseDayKey, resolveDayRange, businessTimeZone } = require("../utils/businessDay");

const COUNT_FIELDS = [
  "totalApartments",
  "occupiedApartments",
  "vacantApartments",
  "checkIns",
  "checkOuts",
  "servicedApartments",
  "housekeepingCount",
  "laundryCount",
  "waterCount",
];
const MAX_COUNT = 100000;
const MAX_SYNC_RECORDS = 366;

class OccupancyError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

// Reads the count fields present in `input` (partial update semantics).
// Present + null/"" -> clear (unknown). Omitted -> leave unchanged.
function readCounts(input) {
  const values = {};
  COUNT_FIELDS.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(input, field)) return;
    const raw = input[field];
    if (raw === null || raw === "") {
      values[field] = null;
      return;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > MAX_COUNT) {
      throw new OccupancyError(`${field} must be a whole number between 0 and ${MAX_COUNT}, or null.`);
    }
    values[field] = n;
  });
  return values;
}

// Merges an update into the existing day and checks it is consistent.
// vacantApartments is derived from total − occupied unless it was sent
// explicitly, in which case it must agree.
function mergeCounts(existing, update) {
  const merged = {};
  COUNT_FIELDS.forEach((f) => {
    merged[f] = Object.prototype.hasOwnProperty.call(update, f) ? update[f] : existing?.[f] ?? null;
  });

  const vacantSent = Object.prototype.hasOwnProperty.call(update, "vacantApartments");
  const { totalApartments: total, occupiedApartments: occupied } = merged;

  if (total !== null && occupied !== null && occupied > total) {
    throw new OccupancyError(`occupiedApartments (${occupied}) cannot exceed totalApartments (${total}).`);
  }
  if (total !== null && occupied !== null) {
    const expected = total - occupied;
    if (vacantSent && merged.vacantApartments !== null && merged.vacantApartments !== expected) {
      throw new OccupancyError(
        `vacantApartments (${merged.vacantApartments}) must equal totalApartments − occupiedApartments (${expected}).`,
      );
    }
    merged.vacantApartments = expected;
  } else if (!vacantSent && (Object.prototype.hasOwnProperty.call(update, "totalApartments") || Object.prototype.hasOwnProperty.call(update, "occupiedApartments"))) {
    merged.vacantApartments = null; // can no longer be derived
  }
  if (total !== null && merged.servicedApartments !== null && merged.servicedApartments > total) {
    throw new OccupancyError(
      `servicedApartments (${merged.servicedApartments}) cannot exceed totalApartments (${total}).`,
    );
  }
  return merged;
}

const readNote = (input) => {
  if (!Object.prototype.hasOwnProperty.call(input, "note")) return undefined;
  const note = input.note === null ? "" : String(input.note).trim();
  if (note.length > 500) throw new OccupancyError("note must be at most 500 characters.");
  return note;
};

const sameCounts = (a, b) => COUNT_FIELDS.every((f) => (a?.[f] ?? null) === (b?.[f] ?? null));

const toJson = (doc) => {
  if (!doc) return null;
  const { __v, ...rest } = doc.toObject ? doc.toObject() : doc;
  return rest;
};

const isDuplicateKeyError = (err) => err && err.code === 11000;

const handleError = (res, err, fallback) => {
  if (err instanceof OccupancyError || err instanceof ExportError) {
    return res.status(err.status).json({ message: err.message });
  }
  console.error(fallback, err);
  return res.status(500).json({ message: fallback });
};

// ---------------- read ----------------

exports.listOccupancy = async (req, res) => {
  try {
    const range = resolveDayRange(req.query, { defaultDays: 31, maxDays: 366 });
    const records = await Occupancy.find({ date: { $gte: range.from, $lte: range.to } })
      .sort({ date: 1 })
      .lean();
    res.json({ from: range.from, to: range.to, timeZone: businessTimeZone(), records: records.map(toJson) });
  } catch (err) {
    handleError(res, err, "Failed to load occupancy");
  }
};

exports.getOccupancyDay = async (req, res) => {
  try {
    const date = parseDayKey(req.params.date);
    if (!date) throw new OccupancyError(`Invalid date "${req.params.date}". Use YYYY-MM-DD.`);
    const record = await Occupancy.findOne({ date }).lean();
    if (!record) return res.status(404).json({ message: `No occupancy record for ${date}.` });
    res.json(toJson(record));
  } catch (err) {
    handleError(res, err, "Failed to load occupancy");
  }
};

// ---------------- manual entry ----------------

// PUT /api/occupancy/:date
// body: any count fields (null clears), note?, manualOverride? (default true)
// A manual save marks the day manualOverride=true so later dashboard syncs
// do not overwrite it; send { manualOverride: false } to hand it back.
exports.putOccupancyDay = async (req, res) => {
  try {
    const date = parseDayKey(req.params.date);
    if (!date) throw new OccupancyError(`Invalid date "${req.params.date}". Use YYYY-MM-DD.`);
    const body = req.body || {};

    const update = readCounts(body);
    const note = readNote(body);
    const existing = await Occupancy.findOne({ date }).lean();
    const merged = mergeCounts(existing, update);

    const manualOverride =
      Object.prototype.hasOwnProperty.call(body, "manualOverride") ? Boolean(body.manualOverride) : true;
    const countsChanged = !existing || !sameCounts(existing, merged) || (note !== undefined && note !== existing.note);

    // Saving only the override flag keeps the record's source as it is.
    const set = { ...merged, manualOverride };
    if (note !== undefined) set.note = note;
    if (countsChanged) {
      set.source = "manual";
      set.manualEditedAt = new Date();
    }

    const record = await Occupancy.findOneAndUpdate(
      { date },
      { $set: set, $setOnInsert: { date } },
      { upsert: true, returnDocument: "after", runValidators: true },
    ).lean();

    res.status(existing ? 200 : 201).json({
      message: existing ? `Occupancy for ${date} updated.` : `Occupancy for ${date} created.`,
      record: toJson(record),
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(409).json({ message: "This day was just created by another request. Please retry." });
    }
    handleError(res, err, "Failed to save occupancy");
  }
};

// ---------------- dashboard sync ----------------

// Optional shared secret. If OCCUPANCY_SYNC_TOKEN is set, the sync endpoint
// requires it as "Authorization: Bearer <token>" or "X-Sync-Token: <token>".
let warnedOpenSync = false;
exports.requireSyncToken = (req, res, next) => {
  const expected = process.env.OCCUPANCY_SYNC_TOKEN;
  if (!expected) {
    if (!warnedOpenSync) {
      console.warn("[occupancy] OCCUPANCY_SYNC_TOKEN is not set: /api/occupancy/sync accepts unauthenticated requests.");
      warnedOpenSync = true;
    }
    return next();
  }
  const header = req.get("authorization") || "";
  const provided = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : (req.get("x-sync-token") || "").trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ message: "Invalid or missing sync token." });
  }
  next();
};

async function syncOne(input, { force, now }) {
  if (!input || typeof input !== "object") throw new OccupancyError("Each record must be an object.");
  const date = parseDayKey(input.date);
  if (!date) throw new OccupancyError(`Invalid date "${input.date}". Use YYYY-MM-DD.`);

  let sourceUpdatedAt = null;
  if (input.updatedAt !== undefined && input.updatedAt !== null && input.updatedAt !== "") {
    sourceUpdatedAt = new Date(input.updatedAt);
    if (Number.isNaN(sourceUpdatedAt.getTime())) throw new OccupancyError(`Invalid updatedAt for ${date}.`);
  }

  const update = readCounts(input);
  const note = readNote(input);
  const existing = await Occupancy.findOne({ date }).lean();

  if (existing?.manualOverride && !force) {
    return { date, status: "skipped_manual_override" };
  }
  if (existing?.sourceUpdatedAt && sourceUpdatedAt && sourceUpdatedAt < existing.sourceUpdatedAt) {
    return { date, status: "skipped_stale" };
  }

  const merged = mergeCounts(existing, update);
  const changed =
    !existing ||
    !sameCounts(existing, merged) ||
    (note !== undefined && note !== existing.note) ||
    existing.source !== "dashboard_sync" ||
    existing.manualOverride;

  const set = { syncedAt: now };
  if (sourceUpdatedAt) set.sourceUpdatedAt = sourceUpdatedAt;
  if (changed) {
    Object.assign(set, merged, { source: "dashboard_sync", manualOverride: false });
    if (note !== undefined) set.note = note;
  }

  const write = () =>
    Occupancy.updateOne({ date }, { $set: set, $setOnInsert: { date } }, { upsert: true, runValidators: true });
  try {
    await write();
  } catch (err) {
    // Two syncs of a new day raced: the other insert won; apply as update.
    if (!isDuplicateKeyError(err)) throw err;
    await write();
  }
  return { date, status: !existing ? "created" : changed ? "updated" : "unchanged" };
}

// POST /api/occupancy/sync
// body: { records: [{ date: "YYYY-MM-DD", ...counts, note?, updatedAt? }], force?: boolean }
// Upserts by date (never duplicates). Omitted fields are left unchanged;
// null clears a field. Days with manualOverride are skipped unless force.
// Re-sending the same payload returns "unchanged" for every day.
// Shared by the push endpoint (POST /sync) and the dashboard pull
// (POST /pull-dashboard): same validation, same upsert rules.
// Throws OccupancyError for request-level problems; per-record problems are
// reported as { status: "invalid", message }.
async function applySyncRecords(records, { force = false } = {}) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new OccupancyError("Body must contain a non-empty records array.");
  }
  if (records.length > MAX_SYNC_RECORDS) {
    throw new OccupancyError(`Send at most ${MAX_SYNC_RECORDS} records per request.`);
  }
  const dates = records.map((r) => parseDayKey(r?.date)).filter(Boolean);
  if (new Set(dates).size !== dates.length) {
    throw new OccupancyError("Each date may appear only once per request.");
  }

  const now = new Date();
  const results = [];
  for (const input of records) {
    try {
      results.push(await syncOne(input, { force: Boolean(force), now }));
    } catch (err) {
      if (err instanceof OccupancyError) {
        results.push({ date: input?.date ?? null, status: "invalid", message: err.message });
      } else {
        throw err;
      }
    }
  }
  return { summary: summarizeResults(results), results };
}

const summarizeResults = (results) =>
  results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});

exports.syncOccupancy = async (req, res) => {
  try {
    const { records, force = false } = req.body || {};
    const { summary, results } = await applySyncRecords(records, { force });
    res.json({ timeZone: businessTimeZone(), summary, results });
  } catch (err) {
    handleError(res, err, "Occupancy sync failed");
  }
};

exports.applySyncRecords = applySyncRecords;
exports.summarizeResults = summarizeResults;
exports.OccupancyError = OccupancyError;
exports.MAX_SYNC_RECORDS = MAX_SYNC_RECORDS;
exports.COUNT_FIELDS = COUNT_FIELDS;
