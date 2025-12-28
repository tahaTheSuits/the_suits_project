
const mongoose = require("mongoose");
const Product = require("../models/productModel");
const StockIn = require("../models/stockInModel");
const StockOut = require("../models/stockOutModel");


// Delete Product
exports.deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "No product ID provided" });

    await Product.findByIdAndDelete(id);
    await StockIn.deleteMany({ product: id });
    await StockOut.deleteMany({ product: id });

    res.status(200).json({ message: "Product deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};