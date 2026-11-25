// Quantity corrections, minStock edits and their audit trail.
// Original movements are never modified: every change is a new, append-only
// Adjustment document with a reason and before/after values.
const mongoose = require("mongoose");
const Product = require("../models/productModel");
const Adjustment = require("../models/adjustmentModel");
const { DEFAULT_UNIT, normalizeUnit } = require("../utils/units");
const {
  MOVEMENT_MODELS,
  availableFor,
  syncQuantityCache,
  computeLedger,
  toStockRow,
  effectiveMinStock,
  productUnitOf,
} = require("../utils/stock");

const REASON_MIN = 3;
const REASON_MAX = 500;
const isDuplicateKeyError = (err) => err && err.code === 11000;

const readReason = (reason, { required }) => {
  const text = typeof reason === "string" ? reason.trim() : "";
  if (!text) return required ? { error: "A reason is required for every correction." } : { value: "" };
  if (text.length < REASON_MIN) return { error: `Reason must be at least ${REASON_MIN} characters.` };
  if (text.length > REASON_MAX) return { error: `Reason must be at most ${REASON_MAX} characters.` };
  return { value: text };
};

// POST /api/adjustments/movement
// body: { movementType: "in"|"out", movementId, correctedQuantity, reason }
// correctedQuantity is the TRUE quantity of that movement, in the product's
// unit (0 voids it). The original movement document is left untouched.
exports.createMovementCorrection = async (req, res) => {
  try {
    const { movementType, movementId, correctedQuantity, reason } = req.body;

    const Model = MOVEMENT_MODELS[movementType];
    if (!Model) return res.status(400).json({ message: 'movementType must be "in" or "out".' });
    if (!mongoose.Types.ObjectId.isValid(movementId)) {
      return res.status(400).json({ message: "Invalid movementId." });
    }

    const corrected = Number(correctedQuantity);
    if (correctedQuantity === "" || correctedQuantity === null || !Number.isFinite(corrected) || corrected < 0) {
      return res.status(400).json({ message: "correctedQuantity must be a number of 0 or more (0 voids the movement)." });
    }

    const reasonResult = readReason(reason, { required: true });
    if (reasonResult.error) return res.status(400).json({ message: reasonResult.error });

    const movement = await Model.findById(movementId).lean();
    if (!movement) return res.status(404).json({ message: "Movement not found." });

    const product = await Product.findById(movement.product).lean();
    if (!product) {
      return res.status(400).json({ message: "This movement references a product that no longer exists." });
    }

    const productUnit = productUnitOf(product);
    const originalUnit = normalizeUnit(movement.unit) || DEFAULT_UNIT;

    const latest = await Adjustment.findOne({ kind: "movement_correction", movement: movement._id })
      .sort({ revision: -1 })
      .lean();
    const previousQuantity = latest ? latest.correctedQuantity : movement.quantity;
    const hadUnitConflict = !latest && originalUnit !== productUnit;

    // Same quantity is still a valid correction when it only confirms the
    // unit of a legacy mismatched movement ("those 8 pcs were 8 gallon").
    if (corrected === previousQuantity && !hadUnitConflict) {
      return res.status(400).json({ message: `Quantity is already ${previousQuantity} ${productUnit}; nothing to correct.` });
    }

    // Stock-in: more received -> more stock. Stock-out: more used -> less stock.
    const quantityDelta = movementType === "in" ? corrected - previousQuantity : previousQuantity - corrected;

    if (quantityDelta < 0) {
      const available = await availableFor(product);
      if (available + quantityDelta < 0) {
        return res.status(400).json({
          message: `This correction would make stock negative (available ${available} ${productUnit}, change ${quantityDelta}).`,
        });
      }
    }

    let adjustment;
    try {
      adjustment = await Adjustment.create({
        product: product._id,
        kind: "movement_correction",
        movementType,
        movement: movement._id,
        revision: (latest?.revision || 0) + 1,
        originalQuantity: movement.quantity,
        originalUnit,
        previousQuantity,
        correctedQuantity: corrected,
        correctedUnit: productUnit,
        quantityDelta,
        reason: reasonResult.value,
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        return res.status(409).json({ message: "This movement was just corrected by someone else. Reload and try again." });
      }
      throw err;
    }

    // Guard against a concurrent stock out using the same stock.
    const after = await availableFor(product);
    if (after < 0) {
      await Adjustment.deleteOne({ _id: adjustment._id });
      await syncQuantityCache(product);
      return res.status(409).json({ message: "Stock changed while saving. Reload and try again." });
    }

    const remainingQuantity = await syncQuantityCache(product);
    res.status(201).json({ adjustment, remainingQuantity, unit: productUnit });
  } catch (err) {
    console.error("correction error:", err);
    res.status(500).json({ message: err.message });
  }
};

// PATCH /api/products/:id/min-stock   body: { minStock: number|null, reason? }
// null (or "") resets to the default threshold.
exports.updateMinStock = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid product ID." });
    }

    const { minStock, reason } = req.body;
    let newMinStock = null;
    if (minStock !== null && minStock !== undefined && minStock !== "") {
      newMinStock = Number(minStock);
      if (!Number.isFinite(newMinStock) || newMinStock < 0) {
        return res.status(400).json({ message: "minStock must be a number of 0 or more, or empty for the default." });
      }
    }

    const reasonResult = readReason(reason, { required: false });
    if (reasonResult.error) return res.status(400).json({ message: reasonResult.error });

    const product = await Product.findById(id).lean();
    if (!product) return res.status(404).json({ message: "Product not found." });

    const before = effectiveMinStock(product.minStock);
    const previousMinStock = before.isDefault ? null : before.value;
    if (previousMinStock === newMinStock) {
      return res.status(400).json({ message: "minStock is unchanged." });
    }

    await Product.updateOne({ _id: product._id }, { $set: { minStock: newMinStock } });
    try {
      await Adjustment.create({
        product: product._id,
        kind: "min_stock_change",
        previousMinStock,
        newMinStock,
        reason: reasonResult.value || "minStock updated",
      });
    } catch (err) {
      // No untraced change: revert if the audit record could not be written.
      await Product.updateOne({ _id: product._id }, { $set: { minStock: product.minStock ?? null } });
      throw err;
    }

    const updated = await Product.findById(product._id).lean();
    const ledger = await computeLedger([updated]);
    res.json({
      message: `Min stock for "${updated.name}" updated.`,
      product: toStockRow(updated, ledger.get(String(updated._id))),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

// GET /api/adjustments?product=<id>&limit=100   (newest first)
exports.listAdjustments = async (req, res) => {
  try {
    const filter = {};
    if (req.query.product) {
      if (!mongoose.Types.ObjectId.isValid(req.query.product)) {
        return res.status(400).json({ message: "Invalid product ID." });
      }
      filter.product = req.query.product;
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

    const adjustments = await Adjustment.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("product", "name unit isActive")
      .lean();

    res.json(
      adjustments.map((a) => ({
        ...a,
        productName: a.product?.name || "Unknown product",
        product: a.product?._id || a.product,
      })),
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

// GET /api/products/:id/movements?limit=200
// Movement history for one product with original vs effective quantities,
// all corrections of each movement, and unit-conflict flags.
exports.getProductMovements = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid product ID." });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);

    const product = await Product.findById(id).lean();
    if (!product) return res.status(404).json({ message: "Product not found." });
    const productUnit = productUnitOf(product);

    const history = (movementType) => [
      { $match: { product: product._id } },
      { $sort: { date: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: Adjustment.collection.name,
          let: { movementId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$movement", "$$movementId"] },
                kind: "movement_correction",
                movementType,
              },
            },
            { $sort: { revision: 1 } },
          ],
          as: "corrections",
        },
      },
    ];

    const [ins, outs] = await Promise.all([
      MOVEMENT_MODELS.in.aggregate(history("in")),
      MOVEMENT_MODELS.out.aggregate(history("out")),
    ]);

    const shape = (movementType) => (m) => {
      const unit = normalizeUnit(m.unit) || DEFAULT_UNIT;
      const latest = m.corrections[m.corrections.length - 1];
      return {
        _id: m._id,
        movementType,
        date: m.date,
        source: m.source,
        note: m.note,
        originalQuantity: m.quantity,
        originalUnit: unit,
        quantity: latest ? latest.correctedQuantity : m.quantity,
        unit: productUnit,
        corrected: Boolean(latest),
        unitConflict: !latest && unit !== productUnit,
        corrections: m.corrections,
      };
    };

    const movements = [...ins.map(shape("in")), ...outs.map(shape("out"))].sort(
      (a, b) => new Date(b.date) - new Date(a.date),
    );

    const ledger = await computeLedger([product]);
    res.json({
      product: toStockRow(product, ledger.get(String(product._id))),
      movements,
      limited: ins.length === limit || outs.length === limit,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};
