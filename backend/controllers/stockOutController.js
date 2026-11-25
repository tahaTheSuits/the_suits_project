// controllers/stockOutController.js
const StockOut = require("../models/stockOutModel");
const { resolveMovementInput, MovementError } = require("../utils/movements");
const { availableFor, syncQuantityCache } = require("../utils/stock");

const readRequestId = (value) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, 100) : undefined;

const isDuplicateKeyError = (err) => err && err.code === 11000;

// A request id that was already used: same product + quantity means the
// client retried / double-submitted -> answer with the existing record.
async function duplicateResponse(res, existing, product, qty) {
  if (String(existing.product) !== String(product._id) || existing.quantity !== qty) {
    return res.status(409).json({ message: "This request id was already used for a different stock out." });
  }
  const remainingQuantity = await availableFor(product);
  return res.status(200).json({
    success: true,
    duplicate: true,
    message: "This stock out was already recorded (duplicate submission ignored).",
    data: {
      stockOutId: existing._id,
      productId: String(product._id),
      quantity: existing.quantity,
      unit: existing.unit,
      remainingQuantity,
    },
  });
}

// Stock Out
// body: { productId, quantity, unit?, note?, clientRequestId? }
// clientRequestId (optional) makes the request idempotent: sending the same
// id twice records the stock out once.
exports.createStockOut = async (req, res) => {
  try {
    const { productId, quantity, unit, note } = req.body;
    const clientRequestId = readRequestId(req.body.clientRequestId);

    const { product, qty, unit: productUnit } = await resolveMovementInput({
      productId,
      quantity,
      unit,
    });

    if (clientRequestId) {
      const existing = await StockOut.findOne({ clientRequestId }).lean();
      if (existing) return duplicateResponse(res, existing, product, qty);
    }

    const available = await availableFor(product);
    if (qty > available) {
      return res.status(400).json({
        message: `Insufficient stock. Available quantity is ${available} ${productUnit}.`,
      });
    }

    let stockOut;
    try {
      stockOut = await StockOut.create({
        product: product._id,
        quantity: qty,
        date: new Date(),
        unit: productUnit,
        note: note || "",
        ...(clientRequestId ? { clientRequestId } : {}),
      });
    } catch (err) {
      // Two identical submissions raced past the check above.
      if (clientRequestId && isDuplicateKeyError(err)) {
        const existing = await StockOut.findOne({ clientRequestId }).lean();
        if (existing) return duplicateResponse(res, existing, product, qty);
      }
      throw err;
    }

    // Guard against two concurrent stock-outs both passing the check above:
    // if the ledger went negative, roll back only the record just created.
    const after = await availableFor(product);
    if (after < 0) {
      await StockOut.deleteOne({ _id: stockOut._id });
      await syncQuantityCache(product);
      return res.status(409).json({
        message: "Stock changed while saving (another stock out was recorded). Please try again.",
        retryable: true,
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
