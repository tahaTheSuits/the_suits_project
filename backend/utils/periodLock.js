// Accounting period lock.
//
// lockedThroughDate "YYYY-MM-DD" (hotel business day, see businessDay.js):
// no stock-affecting change may touch a business day on or before it.
// Enforced on: Stock In / Stock Out creation, product creation with an
// initial quantity, in-place movement edits (original AND new date),
// quantity corrections, and reconciliation (adjustments and alignments,
// which take effect today).
const { Setting, SettingAudit } = require("../models/settingModel");
const { parseDayKey, dayKeyOf, todayKey } = require("./businessDay");

const KEY = "period_lock";
const REASON_MAX = 500;

class PeriodLockError extends Error {
  constructor(lockedThroughDate, message) {
    super(message);
    this.status = 403;
    this.code = "period_locked";
    this.lockedThroughDate = lockedThroughDate;
  }
}

class PeriodLockInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function getPeriodLock() {
  const doc = await Setting.findOne({ key: KEY }).lean();
  return {
    lockedThroughDate: doc?.value?.lockedThroughDate || null,
    updatedAt: doc?.updatedAt || null,
    reason: doc?.reason || "",
  };
}

// Business day of a date-like value ("YYYY-MM-DD" stays as is).
const dayOf = (value) => {
  if (typeof value === "string" && parseDayKey(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : dayKeyOf(d);
};

// Throws PeriodLockError if any of `dates` falls on or before the lock.
// `what` describes the operation for the message, e.g. "edit this entry".
async function assertNotLocked(dates, what = "change stock") {
  const { lockedThroughDate } = await getPeriodLock();
  if (!lockedThroughDate) return;
  const locked = (Array.isArray(dates) ? dates : [dates]).map(dayOf).filter((d) => d && d <= lockedThroughDate);
  if (locked.length) {
    const day = locked.sort()[0];
    throw new PeriodLockError(
      lockedThroughDate,
      `The period is locked through ${lockedThroughDate}: cannot ${what} dated ${day}. Unlock or move the lock date first (Reports → Period lock).`,
    );
  }
}

// Express helper: answers a PeriodLockError, returns true if it did.
function sendIfLocked(res, err) {
  if (!(err instanceof PeriodLockError)) return false;
  res.status(err.status).json({ message: err.message, code: err.code, lockedThroughDate: err.lockedThroughDate });
  return true;
}

// PATCH body: { lockedThroughDate: "YYYY-MM-DD" | null, reason?, expectedLockedThroughDate? }
async function updatePeriodLock(body = {}) {
  if (!Object.prototype.hasOwnProperty.call(body, "lockedThroughDate")) {
    throw new PeriodLockInputError('Send lockedThroughDate ("YYYY-MM-DD", or null to unlock).');
  }
  const raw = body.lockedThroughDate;
  let next = null;
  if (raw !== null && raw !== "") {
    next = parseDayKey(raw);
    if (!next) throw new PeriodLockInputError(`Invalid date "${raw}". Use YYYY-MM-DD.`);
    if (next > todayKey()) throw new PeriodLockInputError("The lock date cannot be in the future.");
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length > REASON_MAX) throw new PeriodLockInputError(`Reason must be at most ${REASON_MAX} characters.`);

  const current = await getPeriodLock();
  const previous = current.lockedThroughDate;
  if (
    Object.prototype.hasOwnProperty.call(body, "expectedLockedThroughDate") &&
    (body.expectedLockedThroughDate || null) !== previous
  ) {
    throw new PeriodLockInputError("The period lock was changed by someone else. Reload and try again.", 409);
  }
  if (previous === next) {
    throw new PeriodLockInputError(next ? `The period is already locked through ${next}.` : "The period is not locked.");
  }

  const action = !next ? "cleared" : !previous ? "set" : next > previous ? "moved_forward" : "moved_back";
  await Setting.updateOne(
    { key: KEY },
    { $set: { value: { lockedThroughDate: next }, reason }, $setOnInsert: { key: KEY } },
    { upsert: true },
  );
  try {
    await SettingAudit.create({
      key: KEY,
      action,
      previousValue: { lockedThroughDate: previous },
      newValue: { lockedThroughDate: next },
      reason,
    });
  } catch (err) {
    // Never leave an unaudited change behind.
    await Setting.updateOne({ key: KEY }, { $set: { value: { lockedThroughDate: previous }, reason: current.reason } });
    throw err;
  }
  return { action, ...(await getPeriodLock()) };
}

async function periodLockHistory(limit = 20) {
  const rows = await SettingAudit.find({ key: KEY }).sort({ createdAt: -1 }).limit(limit).lean();
  return rows.map((r) => ({
    _id: r._id,
    action: r.action,
    previous: r.previousValue?.lockedThroughDate ?? null,
    next: r.newValue?.lockedThroughDate ?? null,
    reason: r.reason,
    createdAt: r.createdAt,
  }));
}

module.exports = {
  PeriodLockError,
  PeriodLockInputError,
  getPeriodLock,
  assertNotLocked,
  sendIfLocked,
  updatePeriodLock,
  periodLockHistory,
  dayOf,
};
