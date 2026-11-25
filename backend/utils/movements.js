// Shared validation for StockIn / StockOut requests.
const mongoose = require("mongoose");
const Product = require("../models/productModel");
const { normalizeUnit } = require("./units");
const { productUnitOf } = require("./stock");

class MovementError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Validates product id, quantity and unit. The movement is always stored in
// the product's own unit; a different unit is rejected instead of being
// silently added to the product's total.
async function resolveMovementInput({ productId, quantity, unit }) {
  if (!productId) throw new MovementError(400, "productId is required.");
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw new MovementError(400, "Invalid productId.");
  }

  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new MovementError(400, "quantity must be a positive number.");
  }

  const product = await Product.findById(productId).lean();
  if (!product) throw new MovementError(404, "Product not found.");
  if (product.isActive === false) {
    throw new MovementError(400, `Product "${product.name}" is archived. Restore it before recording movements.`);
  }

  const productUnit = productUnitOf(product);
  if (unit !== undefined && unit !== null && unit !== "") {
    const requested = normalizeUnit(unit);
    if (!requested) throw new MovementError(400, `Invalid unit "${unit}".`);
    if (requested !== productUnit) {
      throw new MovementError(
        400,
        `Unit mismatch: "${product.name}" is tracked in ${productUnit}, not ${requested}.`,
      );
    }
  }

  return { product, qty, unit: productUnit };
}

module.exports = { MovementError, resolveMovementInput };
