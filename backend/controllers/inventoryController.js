const mongoose = require("mongoose");
const Product = require("../models/productModel");
const StockIn = require("../models/stockInModel");
const StockOut = require("../models/stockOutModel");

// Get Inventory
exports.getInventory = async (req, res) => {
  try {
    const products = await Product.find();
    const inventory = [];
    for (const product of products) {
      const stockInAgg = await StockIn.aggregate([
        { $match: { product: product._id } },
        { $group: { _id: "$product", totalIn: { $sum: "$quantity" } } }
      ]);
      const stockOutAgg = await StockOut.aggregate([
        { $match: { product: product._id } },
        { $group: { _id: "$product", totalOut: { $sum: "$quantity" } } }
      ]);

      const totalIn = stockInAgg[0]?.totalIn || 0;
      const totalOut = stockOutAgg[0]?.totalOut || 0;

      inventory.push({
        _id: product._id,
        product: product.name,
        quantity: totalIn - totalOut,
        unit: product.unit,
        minStock: product.minStock
      });
    }

    res.json(inventory);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};
