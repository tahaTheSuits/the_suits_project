// Phase 1 data check / clean-up. NEVER deletes documents.
//
//   node scripts/phase1Maintenance.js            -> dry run, report only
//   node scripts/phase1Maintenance.js --apply    -> apply the safe updates
//
// Run from the backend/ folder (uses MONGO_URI from backend/.env).
// With --apply it only:
//   1. renames the legacy unit "galon" to "gallon" on products and movements
//   2. re-syncs the cached Product.quantity from the StockIn/StockOut ledger
// Everything else (case-insensitive duplicate names, movements recorded in a
// different unit than their product, orphan movements) is reported for manual
// review and left unchanged.

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const Product = require("../models/productModel");
const StockIn = require("../models/stockInModel");
const StockOut = require("../models/stockOutModel");
const { computeLedger } = require("../utils/stock");

const APPLY = process.argv.includes("--apply");

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not set (expected in backend/.env).");
  }
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
  console.log(APPLY ? "Mode: APPLY (safe updates only)\n" : "Mode: DRY RUN (no changes)\n");

  // 1. Legacy unit spelling
  for (const [label, Model] of [["products", Product], ["stockins", StockIn], ["stockouts", StockOut]]) {
    const count = await Model.collection.countDocuments({ unit: "galon" });
    if (count && APPLY) {
      const result = await Model.collection.updateMany({ unit: "galon" }, { $set: { unit: "gallon" } });
      console.log(`[units] ${label}: updated ${result.modifiedCount} "galon" -> "gallon"`);
    } else {
      console.log(`[units] ${label}: ${count} document(s) use "galon"`);
    }
  }

  // 2. Case-insensitive duplicate names among active products
  const duplicates = await Product.aggregate([
    { $match: { isActive: { $ne: false } } },
    { $group: { _id: { $toLower: { $trim: { input: "$name" } } }, names: { $push: "$name" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  if (duplicates.length) {
    console.log("\n[names] Active products whose names differ only by case (archive one of each):");
    duplicates.forEach((d) => console.log(`  - ${d.names.join(" | ")}`));
  } else {
    console.log("\n[names] No case-insensitive duplicate active names.");
  }

  // 3. Ledger: unit conflicts and quantity cache drift
  const products = await Product.find().lean();
  const ledger = await computeLedger(products);
  let drift = 0;
  let conflicts = 0;
  for (const product of products) {
    const totals = ledger.get(String(product._id));
    if (totals.unitConflicts.length) {
      conflicts += 1;
      const detail = totals.unitConflicts
        .map((c) => `${c.count} ${c.direction} movement(s) = ${c.quantity} ${c.unit}`)
        .join(", ");
      console.log(`[unit-conflict] ${product.name} (${product.unit}): ${detail}`);
    }
    if (Number(product.quantity) !== totals.quantity) {
      drift += 1;
      console.log(`[cache] ${product.name}: cached ${product.quantity}, ledger ${totals.quantity}`);
      if (APPLY) {
        await Product.collection.updateOne({ _id: product._id }, { $set: { quantity: totals.quantity } });
      }
    }
  }
  console.log(`\n[unit-conflict] ${conflicts} product(s) have movements in another unit (still counted, shown as a warning in the UI).`);
  console.log(`[cache] ${drift} product(s) had a stale cached quantity${APPLY ? " (fixed)" : ""}.`);

  // 4. Orphan movements (product document missing, e.g. from the old delete)
  const ids = products.map((p) => p._id);
  const [orphanIn, orphanOut] = await Promise.all([
    StockIn.collection.countDocuments({ product: { $nin: ids } }),
    StockOut.collection.countDocuments({ product: { $nin: ids } }),
  ]);
  console.log(`[orphans] ${orphanIn} stock-in and ${orphanOut} stock-out record(s) reference a missing product (left unchanged).`);

  if (!APPLY) console.log("\nDry run finished. Re-run with --apply to apply the safe updates above.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
