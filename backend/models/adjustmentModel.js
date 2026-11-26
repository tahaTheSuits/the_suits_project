const mongoose = require("mongoose");

// Append-only audit trail. Original StockIn/StockOut documents are never
// edited; a correction records what the movement SHOULD have been, and the
// latest correction of a movement is its effective quantity everywhere
// (ledger, reports, exports). There are no update/delete routes for this
// collection.
//
// kind "movement_correction": fixes the quantity (and, implicitly, the unit)
//   of one StockIn/StockOut. Quantities are always expressed in the
//   product's unit, so a correction also resolves a legacy unit mismatch.
//   correctedQuantity 0 voids the movement.
// kind "min_stock_change": records a minStock edit on a product.
// kind "barcode_change": records setting, changing or clearing a barcode.
// kind "stock_adjustment": a documented stock change that is not a delivery
//   or a usage (opening stock that was never logged, count differences...).
//   quantityDelta is part of the ledger: stock = in − out + Σ adjustments.
//   `date` is the business date it applies to.
// kind "cache_reconcile": the stored Product.quantity was aligned with the
//   ledger (no ledger change); keeps previous/new stored values.
// kind "movement_edit": date / product / note / source of a StockIn or
//   StockOut was edited in place; `changes` holds { field: { from, to } }.
//   (Quantity edits are recorded as movement_correction, as before.)
const adjustmentSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true
    },
    kind: {
      type: String,
      enum: [
        "movement_correction",
        "min_stock_change",
        "barcode_change",
        "stock_adjustment",
        "cache_reconcile",
        "movement_edit",
      ],
      required: true
    },

    // --- movement_correction ---
    movementType: { type: String, enum: ["in", "out"] },
    movement: { type: mongoose.Schema.Types.ObjectId },
    // 1 for the first correction of a movement, 2 for the next, ...
    revision: { type: Number, min: 1 },
    originalQuantity: Number, // as stored on the movement document
    originalUnit: String,
    previousQuantity: Number, // effective quantity before this correction
    correctedQuantity: { type: Number, min: 0 },
    correctedUnit: String, // always the product's unit
    // Effect on the product's stock balance (+ adds stock, - removes stock).
    quantityDelta: Number,

    // --- min_stock_change ---
    previousMinStock: { type: Number, default: undefined }, // null/absent = default
    newMinStock: { type: Number, default: undefined },

    // --- barcode_change --- (null = no barcode)
    previousBarcode: { type: String, default: undefined },
    newBarcode: { type: String, default: undefined },

    // --- stock_adjustment ---
    date: { type: Date, default: undefined },
    unit: String,

    // --- stock_adjustment / cache_reconcile ---
    previousCachedQuantity: Number, // stored Product.quantity before
    newCachedQuantity: Number, // stored Product.quantity after
    ledgerQuantity: Number, // ledger balance at that moment (before the change)

    // --- movement_edit ---
    changes: { type: mongoose.Schema.Types.Mixed, default: undefined },
    previousProduct: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: undefined },

    reason: {
      type: String,
      trim: true,
      maxlength: 500
    }
  },
  { timestamps: true }
);

adjustmentSchema.index({ product: 1, createdAt: -1 });
// Ledger lookups of documented stock adjustments.
adjustmentSchema.index(
  { product: 1, date: 1 },
  { name: "stock_adjustment_product_date", partialFilterExpression: { kind: "stock_adjustment" } }
);
// One revision number per movement: two concurrent corrections of the same
// movement cannot both be based on the same previous value.
adjustmentSchema.index(
  { movement: 1, revision: -1 },
  {
    name: "movement_revision_unique",
    unique: true,
    partialFilterExpression: { kind: "movement_correction" },
  }
);

module.exports = mongoose.model("Adjustment", adjustmentSchema);
