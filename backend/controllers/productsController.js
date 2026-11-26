const mongoose = require("mongoose");
const Product = require("../models/productModel");
const StockIn = require("../models/stockInModel");
const Adjustment = require("../models/adjustmentModel");
const { DEFAULT_UNIT, UNITS, normalizeUnit } = require("../utils/units");
const { DEFAULT_MIN_STOCK, computeLedger, toStockRow } = require("../utils/stock");
const { BARCODE_COLLATION, normalizeBarcode, validateBarcode } = require("../utils/barcode");
const {
  consumptionRuleOf,
  inferConsumptionBasis,
  readConsumptionRule,
  RuleError,
} = require("../utils/consumptionRule");

// Case-insensitive comparison for product names.
const NAME_COLLATION = { locale: "en", strength: 2 };

// Products created before archiving existed have no isActive field.
const ACTIVE_FILTER = { isActive: { $ne: false } };

const findActiveByName = (name, excludeId) => {
  const filter = { name, ...ACTIVE_FILTER };
  if (excludeId) filter._id = { $ne: excludeId };
  return Product.findOne(filter).collation(NAME_COLLATION);
};

const findActiveByBarcode = (barcode, excludeId) => {
  const filter = { barcode, ...ACTIVE_FILTER };
  if (excludeId) filter._id = { $ne: excludeId };
  return Product.findOne(filter).collation(BARCODE_COLLATION);
};

const isDuplicateKeyError = (err) => err && err.code === 11000;
const isBarcodeDuplicate = (err) =>
  isDuplicateKeyError(err) && (err.keyPattern?.barcode || /barcode/.test(err.message || ""));

const barcodeTakenMessage = (barcode, other) =>
  `Barcode "${barcode}" is already used by "${other.name}".`;

async function stockRowFor(product) {
  const ledger = await computeLedger([product]);
  return toStockRow(product, ledger.get(String(product._id)));
}

// Create Product
exports.createProduct = async (req, res) => {
  try {
    const { name, minStock, initialQty, unit, barcode } = req.body;

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

    // Consumption alert rule: basis defaults to the one inferred from the name.
    let rule;
    try {
      rule = readConsumptionRule(req.body);
    } catch (err) {
      if (err instanceof RuleError) return res.status(400).json({ message: err.message });
      throw err;
    }

    // Optional: products without a barcode work exactly as before.
    const barcodeResult = validateBarcode(barcode);
    if (barcodeResult.error) return res.status(400).json({ message: barcodeResult.error });

    const existingProduct = await findActiveByName(trimmedName);
    if (existingProduct) {
      return res.status(400).json({
        message: `Product "${existingProduct.name}" already exists`
      });
    }

    if (barcodeResult.value) {
      const owner = await findActiveByBarcode(barcodeResult.value);
      if (owner) return res.status(409).json({ message: barcodeTakenMessage(barcodeResult.value, owner) });
    }

    const product = await Product.create({
      name: trimmedName,
      minStock: minStockValue,
      unit: normalizedUnit,
      quantity: initialQtyValue,
      isActive: true,
      consumptionBasis: rule.consumptionBasis || inferConsumptionBasis(trimmedName),
      normalMaxThreshold: rule.normalMaxThreshold ?? null,
      ...(barcodeResult.value ? { barcode: barcodeResult.value } : {}),
    });

    if (barcodeResult.value) {
      await Adjustment.create({
        product: product._id,
        kind: "barcode_change",
        previousBarcode: null,
        newBarcode: barcodeResult.value,
        reason: "Barcode set when the product was created",
      });
    }

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
    if (isBarcodeDuplicate(error)) {
      return res.status(409).json({ message: "This barcode is already used by another active product." });
    }
    if (isDuplicateKeyError(error)) {
      return res.status(400).json({
        message:
          "A product with this name already exists. If it was archived, restart the API once so the old name index is replaced.",
      });
    }
    res.status(500).json({ message: error.message });
  }
};

// PATCH /api/products/:id/barcode   body: { barcode: string|null|"", reason? }
// Sets, changes or clears (null / "") a barcode. Every change is recorded in
// the audit trail. Archived products may be edited too; uniqueness only
// applies among active products.
exports.updateBarcode = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid product ID." });
    }

    const barcodeResult = validateBarcode(req.body.barcode);
    if (barcodeResult.error) return res.status(400).json({ message: barcodeResult.error });
    const newBarcode = barcodeResult.value;

    const reasonText = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
    if (reasonText.length > 500) return res.status(400).json({ message: "Reason must be at most 500 characters." });

    const product = await Product.findById(id).lean();
    if (!product) return res.status(404).json({ message: "Product not found." });

    const previousBarcode = normalizeBarcode(product.barcode);
    if (previousBarcode === newBarcode) {
      return res.status(400).json({ message: "Barcode is unchanged." });
    }

    const isActive = product.isActive !== false;
    if (newBarcode && isActive) {
      const owner = await findActiveByBarcode(newBarcode, product._id);
      if (owner) return res.status(409).json({ message: barcodeTakenMessage(newBarcode, owner) });
    }

    // Legacy products without an isActive field are marked active explicitly
    // so the database-level unique index covers their barcode too.
    const update = newBarcode
      ? { $set: { barcode: newBarcode, ...(isActive ? { isActive: true } : {}) } }
      : { $unset: { barcode: "" } };

    try {
      await Product.updateOne({ _id: product._id }, update);
    } catch (err) {
      if (isBarcodeDuplicate(err)) {
        return res.status(409).json({ message: "This barcode is already used by another active product." });
      }
      throw err;
    }

    try {
      await Adjustment.create({
        product: product._id,
        kind: "barcode_change",
        previousBarcode,
        newBarcode,
        reason: reasonText || (newBarcode ? (previousBarcode ? "Barcode changed" : "Barcode set") : "Barcode removed"),
      });
    } catch (err) {
      // No untraced change: revert if the audit record could not be written.
      await Product.updateOne(
        { _id: product._id },
        previousBarcode ? { $set: { barcode: previousBarcode } } : { $unset: { barcode: "" } },
      );
      throw err;
    }

    const updated = await Product.findById(product._id).lean();
    res.json({
      message: newBarcode ? `Barcode for "${updated.name}" saved.` : `Barcode removed from "${updated.name}".`,
      product: await stockRowFor(updated),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

// GET /api/products/by-barcode/:code
// 200 { product } for an active product (with its ledger stock and unit).
// 404 with a clear message when unknown, or when only an archived product
// has that barcode.
exports.getProductByBarcode = async (req, res) => {
  try {
    const barcodeResult = validateBarcode(req.params.code);
    if (barcodeResult.error) return res.status(400).json({ message: barcodeResult.error });
    if (!barcodeResult.value) return res.status(400).json({ message: "Barcode is required." });
    const code = barcodeResult.value;

    const product = await Product.findOne({ barcode: code, ...ACTIVE_FILTER })
      .collation(BARCODE_COLLATION)
      .lean();
    if (product) return res.json({ product: await stockRowFor(product) });

    const archived = await Product.findOne({ barcode: code, isActive: false })
      .collation(BARCODE_COLLATION)
      .sort({ archivedAt: -1 })
      .lean();
    if (archived) {
      return res.status(404).json({
        message: `Barcode "${code}" belongs to "${archived.name}", which is archived. Restore it to use it again.`,
        archived: true,
        productName: archived.name,
      });
    }

    res.status(404).json({ message: `No product has barcode "${code}".`, archived: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

// Archive Product (soft delete). Movements are kept so reports stay intact.
// Archiving also frees the product's barcode for use by another product.
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

// Restore an archived product, unless an active product now uses its name
// or its barcode.
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

    if (product.barcode) {
      const owner = await findActiveByBarcode(product.barcode, product._id);
      if (owner) {
        return res.status(409).json({
          message: `Cannot restore: barcode "${product.barcode}" is now used by "${owner.name}". Remove or change one of the barcodes first.`,
        });
      }
    }

    product.isActive = true;
    product.archivedAt = null;
    await product.save();

    res.status(200).json({ message: `Product "${product.name}" restored.`, product });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(409).json({ message: "Cannot restore: an active product with this name or barcode already exists." });
    }
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

exports.ACTIVE_FILTER = ACTIVE_FILTER;


// PATCH /api/products/:id/consumption-rule
// body: { consumptionBasis?: housekeeping|laundry|water|fixed|none|null,
//         normalMaxThreshold?: positive number|null, reason? }
// null basis returns to the name-based default. Audited as
// consumption_rule_change.
exports.updateConsumptionRule = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid product ID." });
    }
    let update;
    try {
      update = readConsumptionRule(req.body || {});
    } catch (err) {
      if (err instanceof RuleError) return res.status(400).json({ message: err.message });
      throw err;
    }
    if (!Object.keys(update).length) {
      return res.status(400).json({ message: "Send consumptionBasis and/or normalMaxThreshold." });
    }
    const reason = typeof req.body.reason === "string" ? req.body.reason.trim().slice(0, 500) : "";

    const product = await Product.findById(id).lean();
    if (!product) return res.status(404).json({ message: "Product not found." });

    const before = consumptionRuleOf(product);
    const set = {};
    const unset = {};
    if (Object.prototype.hasOwnProperty.call(update, "consumptionBasis")) {
      if (update.consumptionBasis === null) unset.consumptionBasis = "";
      else set.consumptionBasis = update.consumptionBasis;
    }
    if (Object.prototype.hasOwnProperty.call(update, "normalMaxThreshold")) set.normalMaxThreshold = update.normalMaxThreshold;

    const after = consumptionRuleOf({ ...product, ...set, ...(unset.consumptionBasis !== undefined ? { consumptionBasis: undefined } : {}) });
    if (
      before.basis === after.basis &&
      before.inferred === after.inferred &&
      before.normalMaxThreshold === after.normalMaxThreshold
    ) {
      return res.status(400).json({ message: "The consumption rule is unchanged." });
    }

    await Product.updateOne({ _id: product._id }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    try {
      await Adjustment.create({
        product: product._id,
        kind: "consumption_rule_change",
        previousRule: before,
        newRule: after,
        reason: reason || "Consumption alert rule updated",
      });
    } catch (err) {
      // No untraced change: restore the previous values.
      await Product.updateOne(
        { _id: product._id },
        product.consumptionBasis
          ? { $set: { consumptionBasis: product.consumptionBasis, normalMaxThreshold: product.normalMaxThreshold ?? null } }
          : { $unset: { consumptionBasis: "" }, $set: { normalMaxThreshold: product.normalMaxThreshold ?? null } },
      );
      throw err;
    }

    const updated = await Product.findById(product._id).lean();
    res.json({ message: `Consumption rule for "${updated.name}" updated.`, product: await stockRowFor(updated) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};
