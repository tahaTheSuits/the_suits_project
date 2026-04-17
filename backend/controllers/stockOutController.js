// controllers/stockOutController.js
const StockOut = require("../models/stockOutModel");
const StockIn = require("../models/stockInModel");
const Product = require("../models/productModel");
const mongoose = require("mongoose");

// Stock Out
exports.createStockOut = async (req, res) => {
  try {
    const { productId, quantity, unit } = req.body;
    const qty = Number(quantity);
    const normalizedUnit = unit === "galon" ? "gallon" : unit;

    if (!productId) {
      return res.status(400).json({ message: "productId is required." });
    }

    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ message: "quantity must be a positive number." });
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: "Invalid productId." });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found." });
    }

    const productObjectId = new mongoose.Types.ObjectId(productId);
    const [totalInAgg, totalOutAgg] = await Promise.all([
      StockIn.aggregate([
        { $match: { product: productObjectId } },
        { $group: { _id: "$product", totalIn: { $sum: "$quantity" } } },
      ]),
      StockOut.aggregate([
        { $match: { product: productObjectId } },
        { $group: { _id: "$product", totalOut: { $sum: "$quantity" } } },
      ]),
    ]);

    const totalIn = totalInAgg[0]?.totalIn || 0;
    const totalOut = totalOutAgg[0]?.totalOut || 0;
    const available = totalIn - totalOut;

    if (qty > available) {
      return res.status(400).json({
        message: `Insufficient stock. Available quantity is ${available}.`,
      });
    }

    const stockOut = new StockOut({
      product: productObjectId,
      quantity: qty,
      date: new Date(),
      unit: normalizedUnit || product.unit || "pcs",
    });

    await stockOut.save();

    // keep product.quantity in sync with current aggregate-based inventory
    product.quantity = available - qty;
    await product.save();

    res.status(201).json({
      success: true,
      message: "Stock out recorded successfully.",
      data: {
        stockOutId: stockOut._id,
        productId,
        quantity: qty,
        unit: stockOut.unit,
        remainingQuantity: available - qty,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create stock out." });
  }
};