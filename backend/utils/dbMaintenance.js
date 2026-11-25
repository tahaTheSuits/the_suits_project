// Non-destructive index maintenance run at startup. Never touches documents.
const Product = require("../models/productModel");
const StockIn = require("../models/stockInModel");
const StockOut = require("../models/stockOutModel");
const Adjustment = require("../models/adjustmentModel");
const Occupancy = require("../models/occupancyModel");

// The original schema had `name: { unique: true }`, which created a global
// unique index "name_1". That index blocks reusing an archived product's
// name, so it is replaced by "name_active_ci_unique" (active products only,
// case-insensitive). Dropping an index does not remove any data.
async function dropLegacyProductNameIndex() {
  try {
    const indexes = await Product.collection.indexes();
    const legacy = indexes.find(
      (index) => index.name === "name_1" && index.unique && !index.partialFilterExpression,
    );
    if (legacy) {
      await Product.collection.dropIndex("name_1");
      console.log('[db] Dropped legacy unique index "products.name_1" (replaced by name_active_ci_unique).');
    }
  } catch (err) {
    // Collection not created yet -> nothing to drop.
    if (err.codeName === "NamespaceNotFound" || err.code === 26) return;
    console.error("[db] Could not check legacy product name index:", err.message);
  }
}

// Builds the indexes declared in the schemas. A failure (for example two
// active products whose names differ only by case) is logged, not fatal.
async function ensureIndexes() {
  await dropLegacyProductNameIndex();
  const results = await Promise.allSettled([
    Product.createIndexes(),
    StockIn.createIndexes(),
    StockOut.createIndexes(),
    Adjustment.createIndexes(),
    Occupancy.createIndexes(),
  ]);
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      const model = ["Product", "StockIn", "StockOut", "Adjustment", "Occupancy"][i];
      console.error(`[db] Index build failed for ${model}:`, result.reason?.message || result.reason);
    }
  });
}

module.exports = { ensureIndexes, dropLegacyProductNameIndex };
