const mongoose = require("mongoose");
const { unitField } = require("../utils/units");

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true, // يشيل المسافات الزايدة من البداية والنهاية
      // Uniqueness is enforced only among ACTIVE products (see index below),
      // so an archived product's name can be reused by a new product.
    },
    // Cached stock level. The movement ledger (StockIn - StockOut) is the
    // source of truth; this value is re-synced after every movement.
    quantity: {
      type: Number,
      default: 0
    },
    unit: unitField,
    minStock: {
      type: Number,
      default: 5,
      min: 0
    },
    // Soft archiving: archived products keep all their movements so
    // historical reports stay intact. Documents created before this field
    // existed have no value and are treated as active.
    isActive: {
      type: Boolean,
      default: true
    },
    archivedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

// يمنع تكرار اسم المنتج (case-insensitive) between active products only.
productSchema.index(
  { name: 1 },
  {
    name: "name_active_ci_unique",
    unique: true,
    partialFilterExpression: { isActive: true },
    collation: { locale: "en", strength: 2 },
  }
);
productSchema.index({ isActive: 1 });

module.exports = mongoose.model("Product", productSchema);
