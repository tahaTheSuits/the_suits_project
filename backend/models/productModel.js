const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      quantity: {
        type: Number,
        default: 0
      },
      unique: true,
      trim: true
    },
    minStock: {
      type: Number,
      default: 5
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Product",productSchema);