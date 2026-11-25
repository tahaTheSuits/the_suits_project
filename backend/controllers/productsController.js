const mongoose = require("mongoose");
const Product = require("../models/productModel");
const StockIn = require("../models/stockInModel");
const { DEFAULT_UNIT, UNITS, normalizeUnit } = require("../utils/units");
const { DEFAULT_MIN_STOCK } = require("../utils/stock");

// Case-insensitive comparison for product names.
const NAME_COLLATION = { locale: "en", strength: 2 };

// Products created before archiving existed have no isActive field.
const ACTIVE_FILTER = { isActive: { $ne: false } };

const findActiveByName = (name, excludeId) => {
  const filter = { name, ...ACTIVE_FILTER };
  if (excludeId) filter._id = { $ne: excludeId };
  return Product.findOne(filter).collation(NAME_COLLATION);
};

const isDuplicateKeyError = (err) => err && err.code === 11000;

// Create Product
exports.createProduct = async (req, res) => {
  try {
    const { name, minStock, initialQty, unit } = req.body;

    const trimmedName = typeof name === "string" ? name.trim() : "";
    if (!trimmedName) {
      return res.status(400).json({ message: "Product name is required." });
    }

    const normalizedUnit = unit === undefined || unit === "" ? DEFAULT_UNIT : normalizeUnit(unit);
    if (!normalizedUnit) {
      return res.status(400).json({ message: `Invalid unit. Use one of: ${UNITS.join(", ")}.` });
    }

    let minStockValue = DEFAULT_MIN_STOCK;
    if (minStock !== undefined && minStock !== null && minStock !== "") {
      minStockValue = Number(minStock);
      if (!Number.isFinite(minStockValue) || minStockValue < 0) {
        return res.status(400).json({ message: "minStock must be a number of 0 or more." });
      }
    }

    let initialQtyValue = 0;
    if (initialQty !== undefined && initialQty !== null && initialQty !== "") {
      initialQtyValue = Number(initialQty);
      if (!Number.isFinite(initialQtyValue) || initialQtyValue < 0) {
        return res.status(400).json({ message: "Initial quantity must be a number of 0 or more." });
      }
    }

    const existingProduct = await findActiveByName(trimmedName);
    if (existingProduct) {
      return res.status(400).json({
        message: `Product "${existingProduct.name}" already exists`
      });
    }

    const product = await Product.create({
      name: trimmedName,
      minStock: minStockValue,
      unit: normalizedUnit,
      quantity: initialQtyValue,
      isActive: true,
    });

    if (initialQtyValue > 0) {
      try {
        await StockIn.create({
          product: product._id,
          quantity: initialQtyValue,
          source: "Initial Stock",
          unit: normalizedUnit,
        });
      } catch (err) {
        // Keep ledger and cache consistent if the initial movement fails.
        await Product.updateOne({ _id: product._id }, { $set: { quantity: 0 } });
        throw err;
      }
    }

    res.status(201).json(product);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return res.status(400).json({
        message:
          "A product with this name already exists. If it was archived, restart the API once so the old name index is replaced.",
      });
    }
    res.status(500).json({ message: error.message });
  }
};

// Archive Product (soft delete). Movements are kept so reports stay intact.
exports.archiveProduct = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid product ID." });
    }

    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ message: "Product not found." });

    if (product.isActive === false) {
      return res.status(200).json({ message: `Product "${product.name}" is already archived.`, product });
    }

    product.isActive = false;
    product.archivedAt = new Date();
    await product.save();

    res.status(200).json({ message: `Product "${product.name}" archived. Its history is kept.`, product });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

// Restore an archived product, unless an active product now uses its name.
exports.restoreProduct = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid product ID." });
    }

    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ message: "Product not found." });

    if (product.isActive !== false) {
      return res.status(200).json({ message: `Product "${product.name}" is already active.`, product });
    }

    const conflict = await findActiveByName(product.name, product._id);
    if (conflict) {
      return res.status(409).json({
        message: `Cannot restore: an active product named "${conflict.name}" already exists.`,
      });
    }

    product.isActive = true;
    product.archivedAt = null;
    await product.save();

    res.status(200).json({ message: `Product "${product.name}" restored.`, product });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(409).json({ message: "Cannot restore: an active product with this name already exists." });
    }
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

exports.ACTIVE_FILTER = ACTIVE_FILTER;
