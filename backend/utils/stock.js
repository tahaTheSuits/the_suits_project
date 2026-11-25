// Inventory ledger helpers.
// Current stock = sum(effective StockIn) - sum(effective StockOut) per product,
// where a movement's effective quantity is its latest correction
// (Adjustment kind "movement_correction") or, if never corrected, its own
// quantity. Product.quantity is only a cache of that value.

const Product = require("../models/productModel");
const StockIn = require("../models/stockInModel");
const StockOut = require("../models/stockOutModel");
const Adjustment = require("../models/adjustmentModel");
const { DEFAULT_UNIT, normalizeUnit } = require("./units");

const DEFAULT_MIN_STOCK = 5;
const MOVEMENT_MODELS = { in: StockIn, out: StockOut };

// Returns the minStock that should be used for status, and whether it is
// the fallback default (value missing / invalid on the product).
function effectiveMinStock(minStock) {
  const n = Number(minStock);
  const isSet =
    minStock !== null && minStock !== undefined && minStock !== "" && Number.isFinite(n) && n >= 0;
  return isSet
    ? { value: n, isDefault: false }
    : { value: DEFAULT_MIN_STOCK, isDefault: true };
}

// "out" when nothing is left, "low" at or below minStock, otherwise "ok".
function stockStatus(quantity, minStock) {
  if (quantity <= 0) return "out";
  if (quantity <= minStock) return "low";
  return "ok";
}

const productUnitOf = (product) => normalizeUnit(product.unit) || DEFAULT_UNIT;

// Aggregation stage: attaches `latestCorrection` (0 or 1 element) to each
// StockIn/StockOut document.
const latestCorrectionLookup = (movementType) => ({
  $lookup: {
    from: Adjustment.collection.name,
    let: { movementId: "$_id" },
    pipeline: [
      {
        $match: {
          $expr: { $eq: ["$movement", "$$movementId"] },
          kind: "movement_correction",
          movementType,
        },
      },
      { $sort: { revision: -1 } },
      { $limit: 1 },
      { $project: { correctedQuantity: 1, revision: 1, reason: 1, createdAt: 1 } },
    ],
    as: "latestCorrection",
  },
});

// Expression for the effective quantity after latestCorrectionLookup.
const EFFECTIVE_QUANTITY = {
  $ifNull: [{ $arrayElemAt: ["$latestCorrection.correctedQuantity", 0] }, "$quantity"],
};
const IS_CORRECTED = { $gt: [{ $size: "$latestCorrection" }, 0] };

// Computes ledger totals for the given products (lean docs or documents).
// Uncorrected movements recorded in a unit different from the product's
// unit are still counted (they are almost always data-entry mistakes from
// the old free unit dropdown), but they are reported in `unitConflicts` so
// they can be reviewed and corrected. A corrected movement is always in the
// product's unit, so correcting it resolves the conflict.
async function computeLedger(products) {
  const ids = products.map((p) => p._id);
  const pipeline = (movementType) => [
    { $match: { product: { $in: ids } } },
    latestCorrectionLookup(movementType),
    {
      $group: {
        _id: { product: "$product", unit: "$unit", corrected: IS_CORRECTED },
        total: { $sum: EFFECTIVE_QUANTITY },
        count: { $sum: 1 },
      },
    },
  ];

  const [ins, outs] = await Promise.all([
    StockIn.aggregate(pipeline("in")),
    StockOut.aggregate(pipeline("out")),
  ]);

  const units = new Map(products.map((p) => [String(p._id), productUnitOf(p)]));
  const ledger = new Map(
    products.map((p) => [String(p._id), { totalIn: 0, totalOut: 0, conflicts: new Map() }]),
  );

  const add = (rows, direction) => {
    rows.forEach((row) => {
      const id = String(row._id.product);
      const entry = ledger.get(id);
      if (!entry) return;
      const total = Number(row.total) || 0;
      if (direction === "in") entry.totalIn += total;
      else entry.totalOut += total;

      const unit = normalizeUnit(row._id.unit) || DEFAULT_UNIT;
      if (!row._id.corrected && unit !== units.get(id)) {
        const key = `${direction}:${unit}`;
        const conflict = entry.conflicts.get(key) || { direction, unit, quantity: 0, count: 0 };
        conflict.quantity += total;
        conflict.count += row.count;
        entry.conflicts.set(key, conflict);
      }
    });
  };
  add(ins, "in");
  add(outs, "out");

  const result = new Map();
  ledger.forEach((entry, id) => {
    result.set(id, {
      totalIn: entry.totalIn,
      totalOut: entry.totalOut,
      quantity: entry.totalIn - entry.totalOut,
      unitConflicts: [...entry.conflicts.values()],
    });
  });
  return result;
}

// One row per product, shared by GET /api/inventory and the Current Stock
// report/exports so they can never disagree.
function toStockRow(product, totals) {
  const minStock = effectiveMinStock(product.minStock);
  return {
    _id: product._id,
    product: product.name,
    quantity: totals.quantity,
    totalIn: totals.totalIn,
    totalOut: totals.totalOut,
    unit: productUnitOf(product),
    minStock: minStock.value,
    minStockIsDefault: minStock.isDefault,
    status: stockStatus(totals.quantity, minStock.value),
    isActive: product.isActive !== false,
    archivedAt: product.archivedAt || null,
    unitConflicts: totals.unitConflicts,
  };
}

async function getCurrentStock({ includeArchived = false } = {}) {
  const filter = includeArchived ? {} : { isActive: { $ne: false } };
  const products = await Product.find(filter).sort({ name: 1 }).lean();
  const ledger = await computeLedger(products);
  return products.map((product) => toStockRow(product, ledger.get(String(product._id))));
}

async function availableFor(product) {
  const ledger = await computeLedger([product]);
  return ledger.get(String(product._id)).quantity;
}

// Re-syncs the cached Product.quantity from the ledger and returns it.
async function syncQuantityCache(product) {
  const quantity = await availableFor(product);
  await Product.updateOne({ _id: product._id }, { $set: { quantity } });
  return quantity;
}

module.exports = {
  DEFAULT_MIN_STOCK,
  MOVEMENT_MODELS,
  effectiveMinStock,
  stockStatus,
  productUnitOf,
  latestCorrectionLookup,
  EFFECTIVE_QUANTITY,
  IS_CORRECTED,
  computeLedger,
  toStockRow,
  getCurrentStock,
  availableFor,
  syncQuantityCache,
};
