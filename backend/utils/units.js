// Single source of truth for unit names.
// Canonical units are stored for all new records. "galon" is a legacy spelling
// that may still exist in older documents, so schemas keep accepting it and
// every read path normalizes it to "gallon".

const UNITS = ["pcs", "gallon", "bag"];
const LEGACY_UNITS = ["galon"];
const DEFAULT_UNIT = "pcs";

const ALIASES = {
  pcs: "pcs",
  pc: "pcs",
  piece: "pcs",
  pieces: "pcs",
  gallon: "gallon",
  gallons: "gallon",
  galon: "gallon",
  gal: "gallon",
  bag: "bag",
  bags: "bag",
};

// Returns the canonical unit, or null when the value is empty/unknown.
function normalizeUnit(value) {
  if (value === null || value === undefined) return null;
  const key = String(value).trim().toLowerCase();
  if (!key) return null;
  return ALIASES[key] || null;
}

// Mongoose schema definition shared by Product / StockIn / StockOut.
// The setter converts aliases on write; unknown values are passed through
// unchanged so the enum validator rejects them with a clear error.
const unitField = {
  type: String,
  enum: [...UNITS, ...LEGACY_UNITS],
  default: DEFAULT_UNIT,
  set: (value) => normalizeUnit(value) || value,
};

module.exports = { UNITS, LEGACY_UNITS, DEFAULT_UNIT, normalizeUnit, unitField };
