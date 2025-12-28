const mongoose = require("mongoose");

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
    note: String
  },
  { timestamps: true }
);

module.exports = mongoose.model("StockIn",stockInSchema);