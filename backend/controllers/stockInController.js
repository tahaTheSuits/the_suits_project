const StockIn = require("../models/stockInModel");
const { resolveMovementInput, MovementError } = require("../utils/movements");
const { syncQuantityCache } = require("../utils/stock");

// Stock In
exports.addStockIn = async (req, res) => {
  try {
    const { product: productId, quantity, source, note, unit } = req.body;

    // ✅ التحقق من البيانات المطلوبة (product exists, active, unit matches)
    const { product, qty, unit: productUnit } = await resolveMovementInput({
      productId,
      quantity,
      unit,
    });

    // ⿡ إنشاء سجل Stock In
    const entry = await StockIn.create({
      product: product._id,
      quantity: qty,
      source: source || "Unknown", // لو ما حط المستخدم مصدر
      note: note || "",
      date: new Date(),
      unit: productUnit,
    });

    // ⿢ تحديث الكمية المخزنة من السجل (ledger is the source of truth)
    const remainingQuantity = await syncQuantityCache(product);

    res.status(201).json({ ...entry.toObject(), remainingQuantity });
  } catch (err) {
    if (err instanceof MovementError) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error("stockIn error:", err);
    res.status(500).json({ message: err.message });
  }
};
