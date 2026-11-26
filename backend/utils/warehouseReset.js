// Full warehouse wipe ("full_warehouse" reset).
//
// Permanently deletes every product, Stock In, Stock Out, adjustment (the
// product audit trail: corrections, edits, reconciliations, rule changes)
// and occupancy/consumption record, and clears the period lock, so the
// warehouse starts with zero products. Reports are computed from these
// collections, so they are empty afterwards too.
//
// Safety:
//   - disabled unless the API runs with ALLOW_WAREHOUSE_RESET=true (the API
//     has no login, so a public wipe endpoint must be switched on knowingly)
//   - body must contain mode "full_warehouse" and confirm "RESET" or
//     "WIPE ALL" (exact, case-sensitive)
//   - one reset at a time per API process
//   - the wipe is written to the settings audit trail (SettingAudit, which
//     is kept) BEFORE anything is deleted, with the counts and the previous
//     period lock; the result (deleted counts or the failure) is added after
//
// Not a transaction (the collections are deleted one after another): if a
// step fails, the response and the audit entry say which ones were done.
const Product = require("../models/productModel");
const StockIn = require("../models/stockInModel");
const StockOut = require("../models/stockOutModel");
const Adjustment = require("../models/adjustmentModel");
const Occupancy = require("../models/occupancyModel");
const { Setting, SettingAudit } = require("../models/settingModel");
const { getPeriodLock } = require("./periodLock");

const MODE = "full_warehouse";
const CONFIRM_PHRASES = ["RESET", "WIPE ALL"];
const AUDIT_KEY = "warehouse_reset";

// Order matters a little: movements and history first, products last, so a
// partial failure never leaves movements pointing at deleted products.
const TARGETS = [
  { key: "stockOuts", label: "stock out movements", model: StockOut },
  { key: "stockIns", label: "stock in movements", model: StockIn },
  { key: "adjustments", label: "corrections, edits and adjustments", model: Adjustment },
  { key: "occupancyDays", label: "occupancy / consumption days", model: Occupancy },
  { key: "products", label: "products", model: Product },
];

class ResetError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const resetEnabled = (env = process.env) => String(env.ALLOW_WAREHOUSE_RESET || "").trim().toLowerCase() === "true";

async function countAll() {
  const counts = {};
  await Promise.all(
    TARGETS.map(async (t) => {
      counts[t.key] = await t.model.countDocuments();
    }),
  );
  return counts;
}

async function resetPreview() {
  const lock = await getPeriodLock();
  return {
    enabled: resetEnabled(),
    mode: MODE,
    confirmPhrases: CONFIRM_PHRASES,
    counts: await countAll(),
    periodLock: lock.lockedThroughDate,
    labels: Object.fromEntries(TARGETS.map((t) => [t.key, t.label])),
  };
}

let resetInProgress = false;

async function fullWarehouseReset(body = {}) {
  if (!resetEnabled()) {
    throw new ResetError(
      403,
      "Warehouse reset is disabled on this server. Set ALLOW_WAREHOUSE_RESET=true on the API to allow it.",
      "reset_disabled",
    );
  }
  if (body.mode !== MODE) {
    throw new ResetError(400, `mode must be "${MODE}".`, "invalid_mode");
  }
  if (typeof body.confirm !== "string" || !CONFIRM_PHRASES.includes(body.confirm)) {
    throw new ResetError(
      400,
      `Confirmation required: send confirm "RESET" or "WIPE ALL" to permanently delete all warehouse data.`,
      "confirmation_required",
    );
  }
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (resetInProgress) throw new ResetError(409, "A warehouse reset is already running.", "reset_in_progress");
  resetInProgress = true;

  try {
    const before = await countAll();
    const lock = await getPeriodLock();

    // Audit first: if this cannot be written, nothing is deleted.
    const audit = await SettingAudit.create({
      key: AUDIT_KEY,
      action: "full_warehouse_started",
      previousValue: { counts: before, lockedThroughDate: lock.lockedThroughDate },
      newValue: null,
      reason,
    });

    const deleted = {};
    let failure = null;
    for (const target of TARGETS) {
      try {
        const res = await target.model.deleteMany({});
        deleted[target.key] = res.deletedCount;
      } catch (err) {
        failure = { step: target.key, message: err.message };
        break;
      }
    }

    // Period lock and other operational state.
    if (!failure) {
      try {
        if (lock.lockedThroughDate) {
          await SettingAudit.create({
            key: "period_lock",
            action: "cleared",
            previousValue: { lockedThroughDate: lock.lockedThroughDate },
            newValue: { lockedThroughDate: null },
            reason: "Cleared by full warehouse reset",
          });
        }
        await Setting.deleteMany({ key: "period_lock" });
      } catch (err) {
        failure = { step: "periodLock", message: err.message };
      }
    }

    const after = await countAll().catch(() => null);
    await SettingAudit.updateOne(
      { _id: audit._id },
      {
        $set: {
          action: failure ? "full_warehouse_failed" : "full_warehouse",
          newValue: { deleted, remaining: after, failure },
        },
      },
    ).catch(() => {});

    if (failure) {
      const done = Object.keys(deleted).join(", ") || "nothing";
      throw new ResetError(500, `Reset stopped at "${failure.step}" (${failure.message}). Already deleted: ${done}. Run it again to finish.`, "reset_partial");
    }
    return {
      message: "All warehouse data was permanently deleted. The warehouse now has zero products.",
      deleted,
      remaining: after,
      periodLockCleared: Boolean(lock.lockedThroughDate),
      auditId: audit._id,
    };
  } finally {
    resetInProgress = false;
  }
}

module.exports = { fullWarehouseReset, resetPreview, resetEnabled, ResetError, CONFIRM_PHRASES, MODE, AUDIT_KEY };
