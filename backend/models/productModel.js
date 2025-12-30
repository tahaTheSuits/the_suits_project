const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true, // يمنع تكرار اسم المنتج
      trim: true    // يشيل المسافات الزايدة من البداية والنهاية
    },
    quantity: {
      type: Number,
      default: 0
    },
    unit: {
      type: String,
      enum: ["pcs", "carton", "bag"],
      default: "pcs"
    },
    minStock: {
      type: Number,
      default: 5
    }
  },
  { timestamps: true }

);

module.exports = mongoose.model("Product",productSchema);