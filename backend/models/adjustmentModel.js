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
const adjustmentSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true
    },
    kind: {
      type: String,
      enum: ["movement_correction", "min_stock_change", "barcode_change"],
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

    reason: {
      type: String,
      trim: true,
      maxlength: 500
    }
  },
  { timestamps: true }
);

adjustmentSchema.index({ product: 1, createdAt: -1 });
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
