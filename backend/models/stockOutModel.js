const mongoose = require("mongoose");
const { unitField } = require("../utils/units");

const stockOutSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    date: {
      type: Date,
      default: Date.now
    },
    unit: unitField,
    note: String
  },
  { timestamps: true }
);

// Ledger totals per product, and date-range reports.
stockOutSchema.index({ product: 1, date: 1 });
stockOutSchema.index({ date: 1 });
stockOutSchema.index({ createdAt: 1 });

module.exports = mongoose.model("StockOut", stockOutSchema);
