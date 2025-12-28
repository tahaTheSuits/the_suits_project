const mongoose = require("mongoose");
const StockIn = require("../models/stockInModel");
const Product = require("../models/productModel");

// Stock In
exports.addStockIn = async (req, res) => {
  try {
    const { product, quantity, source, note } = req.body;

    if (!product || !quantity) 
      return res.status(400).json({ message: "Product and quantity required" });

    // ⿡ إنشاء سجل Stock In
    const entry = await StockIn.create({
      product: new mongoose.Types.ObjectId(product),
      quantity: Number(quantity),
      source,
      note,
      date: new Date() // تاريخ اليوم تلقائياً
    });

    // ⿢ تحديث كمية المنتج الفعلية
    await Product.findByIdAndUpdate(product, { $inc: { quantity: Number(quantity) } });

    res.status(201).json(entry);
  } catch (err) {
    console.error("stockIn error:", err);
    res.status(500).json({ message: err.message });
  }
};