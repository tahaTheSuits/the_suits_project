// Inventory ledger helpers.
// Current stock = sum(StockIn.quantity) - sum(StockOut.quantity) per product.
// Product.quantity is only a cache of that value.

const Product = require("../models/productModel");
const StockIn = require("../models/stockInModel");
const StockOut = require("../models/stockOutModel");
const { DEFAULT_UNIT, normalizeUnit } = require("./units");

const DEFAULT_MIN_STOCK = 5;

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

// Computes ledger totals for the given products (lean docs or documents).
// Movements recorded in a unit different from the product's unit are still
// counted (they are almost always data-entry mistakes from the old free unit
// dropdown, and dropping them would silently change stock levels), but they
// are reported in `unitConflicts` so they can be reviewed instead of being
// silently summed.
async function computeLedger(products) {
  const ids = products.map((p) => p._id);
  const pipeline = [
    { $match: { product: { $in: ids } } },
    {
      $group: {
        _id: { product: "$product", unit: "$unit" },
        total: { $sum: "$quantity" },
        count: { $sum: 1 },
      },
    },
  ];

  const [ins, outs] = await Promise.all([
    StockIn.aggregate(pipeline),
    StockOut.aggregate(pipeline),
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
      if (unit !== units.get(id)) {
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
  effectiveMinStock,
  stockStatus,
  productUnitOf,
  computeLedger,
  availableFor,
  syncQuantityCache,
};
