// Per-product consumption rule used by the consumption alerts:
//
//   consumptionBasis   what the product's daily use is measured against
//     housekeeping  per housekeeping room (falls back to serviced rooms)
//     laundry       per laundry service
//     water         per water-service apartment
//     fixed         daily total (no service count)
//     none          never evaluated
//   normalMaxThreshold optional positive cap
//     fixed                         max total units in one day; a day is
//                                   flagged when its quantity > cap
//     housekeeping/laundry/water    max units per room/service; the day's
//                                   rate = quantity ÷ that day's service
//                                   count, flagged when rate > cap
//
// Products saved before these fields existed have no basis: it is inferred
// from the name (water / bottle -> water; tide, clora, detergent, bleach,
// laundry -> laundry; anything else -> housekeeping). Nothing is written
// back; the inference is shown as such until the user sets a basis.

const CONSUMPTION_BASES = ["housekeeping", "laundry", "water", "fixed", "none"];
const DEFAULT_BASIS = "housekeeping";
const MAX_THRESHOLD = 1000000;

const BASIS_LABELS = {
  housekeeping: { rate: "per housekeeping room", count: "housekeeping rooms", short: "Housekeeping" },
  laundry: { rate: "per laundry room", count: "laundry services", short: "Laundry" },
  water: { rate: "per water apartment", count: "water apartments", short: "Water" },
  fixed: { rate: "per day", count: null, short: "Fixed daily" },
  none: { rate: null, count: null, short: "No alerts" },
};

const WATER_PATTERN = /water|bottle/i;
const LAUNDRY_PATTERN = /tide|clora|detergent|bleach|laundry/i;

function inferConsumptionBasis(name) {
  const text = typeof name === "string" ? name : "";
  if (WATER_PATTERN.test(text)) return "water";
  if (LAUNDRY_PATTERN.test(text)) return "laundry";
  return DEFAULT_BASIS;
}

// Effective rule of a product (lean doc or row with `name`).
function consumptionRuleOf(product) {
  const stored = product?.consumptionBasis;
  const isSet = CONSUMPTION_BASES.includes(stored);
  const threshold = Number(product?.normalMaxThreshold);
  return {
    basis: isSet ? stored : inferConsumptionBasis(product?.name),
    inferred: !isSet,
    normalMaxThreshold:
      product?.normalMaxThreshold !== null && product?.normalMaxThreshold !== undefined && Number.isFinite(threshold) && threshold > 0
        ? threshold
        : null,
  };
}

class RuleError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// Reads { consumptionBasis?, normalMaxThreshold? } from a request body.
// Omitted -> not returned (unchanged). Basis ""/null -> back to inferred.
// Threshold ""/null -> cleared.
function readConsumptionRule(body = {}) {
  const out = {};
  if (has(body, "consumptionBasis")) {
    const raw = body.consumptionBasis;
    if (raw === null || raw === "") out.consumptionBasis = null;
    else if (typeof raw === "string" && CONSUMPTION_BASES.includes(raw.trim().toLowerCase())) {
      out.consumptionBasis = raw.trim().toLowerCase();
    } else {
      throw new RuleError(`consumptionBasis must be one of: ${CONSUMPTION_BASES.join(", ")}.`);
    }
  }
  if (has(body, "normalMaxThreshold")) {
    const raw = body.normalMaxThreshold;
    if (raw === null || raw === "") out.normalMaxThreshold = null;
    else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0 || n > MAX_THRESHOLD) {
        throw new RuleError("normalMaxThreshold must be a positive number, or empty for none.");
      }
      out.normalMaxThreshold = Math.round(n * 10000) / 10000;
    }
  }
  return out;
}

module.exports = {
  CONSUMPTION_BASES,
  BASIS_LABELS,
  DEFAULT_BASIS,
  inferConsumptionBasis,
  consumptionRuleOf,
  readConsumptionRule,
  RuleError,
};
