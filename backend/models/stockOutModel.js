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
    date: {
      type: Date,
      default: Date.now
    },
    unit: {
      type: String,
      enum: ["pcs", "gallon", "galon", "bag"],
      default: "pcs"
    },
    note: String
  },
  { timestamps: true }
);

module.exports = mongoose.model("StockOut", stockOutSchema);