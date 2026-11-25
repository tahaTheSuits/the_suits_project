const mongoose = require("mongoose");
const { unitField } = require("../utils/units");

const stockInSchema = new mongoose.Schema(
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
    source: {
      type: String,
      default: "Main Hotel"
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
stockInSchema.index({ product: 1, date: 1 });
stockInSchema.index({ date: 1 });
stockInSchema.index({ createdAt: 1 });

module.exports = mongoose.model("StockIn", stockInSchema);
