// In-place editing of a Stock In / Stock Out record.
//
// PATCH /api/movements/:type/:id
//   body: { quantity?, date?, productId?, note?, source? (stock in only),
//           reason (required), expectedUpdatedAt? }
//
// The record itself is updated (no delete + re-enter, so no duplicate
// purchase or usage is ever created) and stamped with editedAt. The audit
// trail stays complete:
//   - a quantity change is a movement_correction (same as Phase 2: the
//     ledger uses the latest corrected quantity, the original is kept)
//   - date / product / note / source changes are a movement_edit with
//     { field: { from, to } }
// The stored stock (Product.quantity) of each affected product moves by the
// exact delta: Stock In newQty − oldQty, Stock Out oldQty − newQty, and a
// product change moves the whole quantity between the two products. Nothing
// is saved if the ledger or the stored stock of any product would go
// negative; partial work is rolled back.
const mongoose = require("mongoose");
const Product = require("../models/productModel");
const Adjustment = require("../models/adjustmentModel");
const { DEFAULT_UNIT, normalizeUnit } = require("./units");
const { MOVEMENT_MODELS, computeLedger, productUnitOf, roundQty } = require("./stock");
const { assertNotLocked } = require("./periodLock");

const REASON_MIN = 3;
const REASON_MAX = 500;
const NOTE_MAX = 500;
const SOURCE_MAX = 100;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

class MovementEditError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const fail = (status, message) => {
  throw new MovementEditError(status, message);
};

function readReason(reason) {
  const text = typeof reason === "string" ? reason.trim() : "";
  if (text.length < REASON_MIN) fail(400, `A reason of at least ${REASON_MIN} characters is required for every edit.`);
  if (text.length > REASON_MAX) fail(400, `Reason must be at most ${REASON_MAX} characters.`);
  return text;
}

function readText(value, field, max) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") fail(400, `${field} must be text.`);
  const text = value.trim();
  if (text.length > max) fail(400, `${field} must be at most ${max} characters.`);
  return text;
}

async function editMovement(movementType, id, body = {}) {
  const Model = MOVEMENT_MODELS[movementType];
  if (!Model) fail(400, 'Movement type must be "in" or "out".');
  if (!mongoose.Types.ObjectId.isValid(id)) fail(400, "Invalid movement ID.");
  const reason = readReason(body.reason);

  const movement = await Model.findById(id).lean();
  if (!movement) fail(404, "Movement not found.");
  if (
    body.expectedUpdatedAt &&
    movement.updatedAt &&
    new Date(body.expectedUpdatedAt).getTime() !== new Date(movement.updatedAt).getTime()
  ) {
    fail(409, "This entry was changed by someone else. Reload and try again.");
  }

  const oldProduct = await Product.findById(movement.product).lean();
  if (!oldProduct) fail(400, "This entry references a product that no longer exists.");
  const unit = productUnitOf(oldProduct);

  const latest = await Adjustment.findOne({ kind: "movement_correction", movement: movement._id })
    .sort({ revision: -1 })
    .lean();
  const oldQty = latest ? latest.correctedQuantity : movement.quantity;

  // ---- what changes ----
  const fieldChanges = {};
  const set = {};
  let newQty;

  if (has(body, "quantity")) {
    const q = Number(body.quantity);
    if (body.quantity === "" || body.quantity === null || !Number.isFinite(q) || q < 0) {
      fail(400, "Quantity must be a number of 0 or more (0 voids the entry).");
    }
    if (roundQty(q) !== oldQty) newQty = roundQty(q);
  }

  if (has(body, "date") && body.date !== null && body.date !== "") {
    const d = new Date(body.date);
    if (Number.isNaN(d.getTime())) fail(400, "Invalid date.");
    if (d.getTime() > Date.now() + FUTURE_TOLERANCE_MS) fail(400, "The date cannot be in the future.");
    if (!movement.date || d.getTime() !== new Date(movement.date).getTime()) {
      fieldChanges.date = { from: movement.date || null, to: d };
      set.date = d;
    }
  }

  let newProduct = null;
  if (has(body, "productId") && body.productId && String(body.productId) !== String(movement.product)) {
    if (!mongoose.Types.ObjectId.isValid(body.productId)) fail(400, "Invalid product ID.");
    newProduct = await Product.findById(body.productId).lean();
    if (!newProduct) fail(404, "The selected product does not exist.");
    if (newProduct.isActive === false) fail(400, `"${newProduct.name}" is archived. Restore it first.`);
    const newUnit = productUnitOf(newProduct);
    if (newUnit !== unit) {
      fail(400, `"${oldProduct.name}" is counted in ${unit} but "${newProduct.name}" in ${newUnit}. Move entries only between products with the same unit.`);
    }
    fieldChanges.product = {
      from: movement.product,
      to: newProduct._id,
      fromName: oldProduct.name,
      toName: newProduct.name,
    };
    set.product = newProduct._id;
  }

  if (has(body, "note")) {
    const note = readText(body.note, "Note", NOTE_MAX);
    if (note !== (movement.note || "")) {
      fieldChanges.note = { from: movement.note || "", to: note };
      set.note = note;
    }
  }

  if (movementType === "in" && has(body, "source")) {
    const source = readText(body.source, "Source", SOURCE_MAX) || "Main Hotel";
    if (source !== (movement.source || "")) {
      fieldChanges.source = { from: movement.source || "", to: source };
      set.source = source;
    }
  }

  if (newQty === undefined && Object.keys(fieldChanges).length === 0) fail(400, "Nothing changed.");

  // Period lock: neither the entry's current date nor its new date may be
  // inside the locked period.
  await assertNotLocked(movement.date || new Date(), "edit an entry");
  if (set.date) await assertNotLocked(set.date, "move an entry to a date");

  // ---- stock deltas per product ----
  const target = newProduct || oldProduct;
  const newEff = newQty === undefined ? oldQty : newQty;
  const sign = movementType === "in" ? 1 : -1;
  const deltas = new Map();
  const addDelta = (product, delta) => {
    const key = String(product._id);
    const entry = deltas.get(key) || { product, delta: 0 };
    entry.delta = roundQty(entry.delta + delta);
    deltas.set(key, entry);
  };
  addDelta(oldProduct, -sign * oldQty);
  addDelta(target, sign * newEff);

  // ---- apply, with rollback ----
  const now = new Date();
  const createdAdjustments = [];
  const appliedCache = [];
  let fieldsUpdated = false;

  const rollback = async () => {
    await Promise.allSettled([
      ...createdAdjustments.map((a) => Adjustment.deleteOne({ _id: a._id })),
      ...appliedCache.map(({ id: pid, delta }) => Product.updateOne({ _id: pid }, { $inc: { quantity: -delta } })),
    ]);
    if (fieldsUpdated) {
      await Model.updateOne(
        { _id: movement._id },
        {
          $set: {
            date: movement.date,
            product: movement.product,
            note: movement.note,
            ...(movementType === "in" ? { source: movement.source } : {}),
            editedAt: movement.editedAt ?? null,
          },
          $inc: { editCount: -1 },
        },
      );
    }
  };

  try {
    const filter = { _id: movement._id };
    if (movement.updatedAt) filter.updatedAt = movement.updatedAt;
    const updated = await Model.updateOne(filter, { $set: { ...set, editedAt: now }, $inc: { editCount: 1 } });
    if (updated.matchedCount !== 1) fail(409, "This entry was changed by someone else. Reload and try again.");
    fieldsUpdated = true;

    if (newQty !== undefined) {
      try {
        createdAdjustments.push(
          await Adjustment.create({
            product: target._id,
            kind: "movement_correction",
            movementType,
            movement: movement._id,
            revision: (latest?.revision || 0) + 1,
            originalQuantity: movement.quantity,
            originalUnit: normalizeUnit(movement.unit) || DEFAULT_UNIT,
            previousQuantity: oldQty,
            correctedQuantity: newQty,
            correctedUnit: unit,
            quantityDelta: sign * (newQty - oldQty),
            reason,
          }),
        );
      } catch (err) {
        if (err && err.code === 11000) fail(409, "This entry was just corrected by someone else. Reload and try again.");
        throw err;
      }
    }

    if (Object.keys(fieldChanges).length) {
      createdAdjustments.push(
        await Adjustment.create({
          product: target._id,
          kind: "movement_edit",
          movementType,
          movement: movement._id,
          changes: fieldChanges,
          ...(newProduct ? { previousProduct: oldProduct._id } : {}),
          reason,
        }),
      );
    }

    // Ledger may not go negative for any product that loses stock.
    const losing = [...deltas.values()].filter((d) => d.delta < 0);
    if (losing.length) {
      const ledger = await computeLedger(losing.map((d) => d.product));
      losing.forEach(({ product }) => {
        const balance = ledger.get(String(product._id)).quantity;
        if (balance < 0) {
          fail(400, `This edit would make the stock of "${product.name}" negative (${balance} ${unit}).`);
        }
      });
    }

    // Stored stock moves by the exact delta, never below zero.
    for (const { product, delta } of deltas.values()) {
      if (delta === 0) continue;
      const guard = delta < 0 ? { quantity: { $gte: -delta } } : {};
      const res = await Product.updateOne({ _id: product._id, ...guard }, { $inc: { quantity: delta } });
      if (res.matchedCount !== 1) {
        const fresh = await Product.findById(product._id).lean();
        fail(
          400,
          `The stored stock of "${product.name}" (${fresh?.quantity ?? "?"} ${unit}) would become negative. Check its ledger balance first.`,
        );
      }
      appliedCache.push({ id: product._id, delta });
    }
  } catch (err) {
    await rollback();
    throw err;
  }

  const affected = await Product.find({ _id: { $in: [...deltas.keys()] } }).lean();
  const ledger = await computeLedger(affected);
  return {
    message: "Entry updated.",
    movement: { ...(await Model.findById(movement._id).lean()), quantity: newEff, movementType },
    changes: {
      ...fieldChanges,
      ...(newQty !== undefined ? { quantity: { from: oldQty, to: newQty } } : {}),
    },
    stock: affected.map((p) => ({
      productId: p._id,
      product: p.name,
      unit: productUnitOf(p),
      ledger: ledger.get(String(p._id)).quantity,
      stored: p.quantity,
    })),
  };
}

module.exports = { editMovement, MovementEditError };
