// controllers/stockOutController.js
const StockOut = require("../models/stockOutModel");

// Stock Out
exports.createStockOut = async (req, res) => {
  try {
    const { product, quantity, usedBy, floor, unit } = req.body;

    if (!product || !quantity || !usedBy) {
      return res.status(400).json({ message: "Product, quantity and usedBy are required" });
    }

    // إنشاء مستند جديد بالـ StockOut
    const stockOut = new StockOut({
      product,
      quantity,
      usedBy,
      floor: floor || "N/A", // لو المستخدم ما كتب طابق، نضع "N/A"
      date: new Date(), // التاريخ الحالي تلقائي
      unit: unit || "pcs",
    });

    await stockOut.save();

    res.status(201).json({ message: "Stock Out recorded successfully!", stockOut });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create stock out" });
  }
};