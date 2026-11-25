// controllers/stockOutController.js
const StockOut = require("../models/stockOutModel");
const { resolveMovementInput, MovementError } = require("../utils/movements");
const { availableFor, syncQuantityCache } = require("../utils/stock");

// Stock Out
exports.createStockOut = async (req, res) => {
  try {
    const { productId, quantity, unit, note } = req.body;

    const { product, qty, unit: productUnit } = await resolveMovementInput({
      productId,
      quantity,
      unit,
    });

    const available = await availableFor(product);
    if (qty > available) {
      return res.status(400).json({
        message: `Insufficient stock. Available quantity is ${available} ${productUnit}.`,
      });
    }

    const stockOut = await StockOut.create({
      product: product._id,
      quantity: qty,
      date: new Date(),
      unit: productUnit,
      note: note || "",
    });

    // Guard against two concurrent stock-outs both passing the check above:
    // if the ledger went negative, roll back only the record just created.
    const after = await availableFor(product);
    if (after < 0) {
      await StockOut.deleteOne({ _id: stockOut._id });
      await syncQuantityCache(product);
      return res.status(409).json({
        message: "Stock changed while saving (another stock out was recorded). Please try again.",
      });
    }

    const remainingQuantity = await syncQuantityCache(product);

    res.status(201).json({
      success: true,
      message: "Stock out recorded successfully.",
      data: {
        stockOutId: stockOut._id,
        productId: String(product._id),
        quantity: qty,
        unit: stockOut.unit,
        remainingQuantity,
      },
    });
  } catch (err) {
    if (err instanceof MovementError) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error(err);
    res.status(500).json({ message: "Failed to create stock out." });
  }
};
