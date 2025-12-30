const mongoose = require("mongoose");
const StockIn = require("../models/stockInModel");
const Product = require("../models/productModel");

// Stock In
exports.addStockIn = async (req, res) => {
  try {
    const { product, quantity, source, note, unit } = req.body;

    // ✅ التحقق من البيانات المطلوبة
    if (!product || !quantity) {
      return res.status(400).json({ message: "Product and quantity required" });
    }

    // ⿡ إنشاء سجل Stock In
    const entry = await StockIn.create({
      product: new mongoose.Types.ObjectId(product),
      quantity: Number(quantity),
      source: source || "Unknown", // لو ما حط المستخدم مصدر
      note: note || "",
      date: new Date(),
      unit: unit || "pcs", // لو ما حط المستخدم unit، خليها pcs
    });

    // ⿢ تحديث كمية المنتج الفعلية
    await Product.findByIdAndUpdate(product, { $inc: { quantity: Number(quantity) } });

    res.status(201).json(entry);
  } catch (err) {
    console.error("stockIn error:", err);
    res.status(500).json({ message: err.message });
}
};