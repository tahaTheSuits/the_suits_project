const mongoose = require("mongoose");

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
    usedBy: {
      type: String,
      required: true
    },
    floor: {
      type: String,
      required: true,
      default: "N/A"
    },
    date: {
      type: Date,
      default: Date.now
    },
        unit: {
      type: String,
      enum: ["pcs", "galon", "bag"],
      default: "pcs"
    },
    note: String
  },
  { timestamps: true }
);

module.exports = mongoose.model("StockOut", stockOutSchema);