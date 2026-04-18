const mongoose = require("mongoose");
const Product = require("../models/productModel");
const StockIn = require("../models/stockInModel");
const StockOut = require("../models/stockOutModel");

// Get Inventory
exports.getInventory = async (req, res) => {
  try {
    const [products, stockInTotals, stockOutTotals] = await Promise.all([
      Product.find(),
      StockIn.aggregate([
        { $group: { _id: "$product", totalIn: { $sum: "$quantity" } } },
      ]),
      StockOut.aggregate([
        { $group: { _id: "$product", totalOut: { $sum: "$quantity" } } },
      ]),
    ]);

    const stockInMap = new Map(
      stockInTotals.map((entry) => [String(entry._id), Number(entry.totalIn) || 0]),
    );
    const stockOutMap = new Map(
      stockOutTotals.map((entry) => [String(entry._id), Number(entry.totalOut) || 0]),
    );

    const inventory = products.map((product) => {
      const productId = String(product._id);
      const totalIn = stockInMap.get(productId) || 0;
      const totalOut = stockOutMap.get(productId) || 0;

      return {
        _id: product._id,
        product: product.name,
        quantity: totalIn - totalOut,
        unit: product.unit,
        minStock: product.minStock,
      };
    });

    res.json(inventory);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};
