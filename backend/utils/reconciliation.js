// Stock ledger reconciliation and root-cause diagnostics.
//
//   expected (ledger) = Σ Stock In − Σ Stock Out + Σ stock adjustments
//                       (movement corrections applied)
//   current (stored)  = Product.quantity
//
// A product is "balanced" when both agree. When they do not, or when the
// history looks suspicious, diagnoseProduct() explains the probable causes:
//
//   unlogged_initial_stock  stored stock higher than the ledger and no Stock In
//                           was logged when the product was created
//   manual_stock_edit       stored stock changed without a movement
//   possible_duplicates     same product + type + quantity within 5 minutes
//   negative_drift          replaying the history, the balance went below 0
//                           at some point (a usage logged before its delivery,
//                           a missing stock in, or a wrong date)
//
// Nothing here changes data; see reconcileProduct() for the two fixes.
const mongoose = require("mongoose");
const Product = require("../models/productModel");
const StockIn = require("../models/stockInModel");
const StockOut = require("../models/stockOutModel");
const Adjustment = require("../models/adjustmentModel");
const {
  latestCorrectionLookup,
  EFFECTIVE_QUANTITY,
  IS_CORRECTED,
  computeLedger,
  productUnitOf,
  reconciliationOf,
  roundQty,
} = require("./stock");

const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
const INITIAL_STOCK_WINDOW_MS = 2 * 60 * 1000;
const REASON_MIN = 3;
const REASON_MAX = 500;

class ReconcileError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const createdAtOf = (doc) =>
  doc.createdAt ? new Date(doc.createdAt) : doc._id?.getTimestamp ? doc._id.getTimestamp() : null;

const signed = (n) => (n > 0 ? `+${n}` : String(n));

// Effective movements of one product, oldest first.
async function loadHistory(product) {
  const pipeline = (movementType) => [
    { $match: { product: product._id } },
    latestCorrectionLookup(movementType),
    {
      $project: {
        date: 1,
        createdAt: 1,
        source: 1,
        note: 1,
        originalQuantity: "$quantity",
        quantity: EFFECTIVE_QUANTITY,
        corrected: IS_CORRECTED,
      },
    },
  ];
  const [ins, outs, adjustments] = await Promise.all([
    StockIn.aggregate(pipeline("in")),
    StockOut.aggregate(pipeline("out")),
    Adjustment.find({ product: product._id, kind: "stock_adjustment" }).lean(),
  ]);
  const events = [
    ...ins.map((m) => ({ ...m, type: "in", delta: m.quantity })),
    ...outs.map((m) => ({ ...m, type: "out", delta: -m.quantity })),
    ...adjustments.map((a) => ({
      _id: a._id,
      type: "adjustment",
      date: a.date || a.createdAt,
      createdAt: a.createdAt,
      quantity: Math.abs(a.quantityDelta),
      delta: a.quantityDelta,
      note: a.reason,
    })),
  ];
  // Same instant: deliveries and adjustments before usages.
  const order = { adjustment: 0, in: 1, out: 2 };
  events.sort(
    (a, b) =>
      new Date(a.date) - new Date(b.date) ||
      order[a.type] - order[b.type] ||
      new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
  );
  return events;
}

function findDuplicates(events) {
  const groups = [];
  ["in", "out"].forEach((type) => {
    const list = events.filter((e) => e.type === type && e.quantity > 0);
    let current = null;
    for (let i = 1; i < list.length; i += 1) {
      const a = list[i - 1];
      const b = list[i];
      const close = Math.abs(new Date(b.date) - new Date(a.date)) <= DUPLICATE_WINDOW_MS;
      if (close && a.quantity === b.quantity) {
        if (current && current.items[current.items.length - 1] === a) current.items.push(b);
        else {
          current = { type, quantity: a.quantity, items: [a, b] };
          groups.push(current);
        }
      } else {
        current = null;
      }
    }
  });
  return groups;
}

function replayBalance(events) {
  let balance = 0;
  const dips = [];
  events.forEach((e) => {
    balance = roundQty(balance + e.delta);
    if (balance < 0) dips.push({ event: e, balance });
  });
  return { dips, finalBalance: balance };
}

const brief = (e) => ({
  id: String(e._id),
  type: e.type,
  date: e.date,
  quantity: e.quantity,
  note: e.note || e.source || "",
  corrected: Boolean(e.corrected),
});

async function diagnoseProduct(productId) {
  if (!mongoose.Types.ObjectId.isValid(productId)) throw new ReconcileError(400, "Invalid product ID.");
  const product = await Product.findById(productId).lean();
  if (!product) throw new ReconcileError(404, "Product not found.");

  const unit = productUnitOf(product);
  const [ledger, events, lastAudit] = await Promise.all([
    computeLedger([product]).then((m) => m.get(String(product._id))),
    loadHistory(product),
    Adjustment.findOne({ product: product._id }).sort({ createdAt: -1 }).lean(),
  ]);
  const recon = reconciliationOf(product, ledger.quantity);
  const diff = recon.difference ?? 0;
  const causes = [];

  // 1. Unlogged initial stock
  const createdAt = createdAtOf(product);
  const initialIn = events.find(
    (e) =>
      e.type === "in" &&
      (/initial/i.test(e.source || "") ||
        (createdAt && Math.abs(new Date(e.createdAt || e.date) - createdAt) <= INITIAL_STOCK_WINDOW_MS)),
  );
  const unloggedInitial = diff > 0 && !initialIn;
  if (unloggedInitial) {
    causes.push({
      code: "unlogged_initial_stock",
      likelihood: "likely",
      title: "Unlogged initial stock",
      detail: `The stored stock is ${diff} ${unit} higher than the ledger, and no Stock In was logged when the product was created${createdAt ? ` (${createdAt.toISOString().slice(0, 10)})` : ""}. The product was probably created with a starting quantity that never became a movement.`,
      suggestion: `Log a stock adjustment of ${signed(diff)} ${unit} as opening stock.`,
      amount: diff,
    });
  }

  // 2. Manual direct edit of the stored stock
  if (diff !== 0) {
    const lastActivity = [...events.map((e) => new Date(e.createdAt || e.date)), lastAudit ? new Date(lastAudit.createdAt) : null]
      .filter(Boolean)
      .reduce((max, d) => (d > max ? d : max), new Date(0));
    const updatedAt = product.updatedAt ? new Date(product.updatedAt) : null;
    const editedAfter = updatedAt && updatedAt - lastActivity > 1000;
    causes.push({
      code: "manual_stock_edit",
      likelihood: !unloggedInitial || editedAfter ? "likely" : "possible",
      title: "Stored stock edited without a movement",
      detail:
        `The stored stock (${recon.current} ${unit}) differs from the ledger (${recon.expected} ${unit}) by ${signed(diff)}.` +
        (editedAfter
          ? ` The product record was last changed on ${updatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC, after its last logged movement or audited change.`
          : " No movement or audited change explains the difference."),
      suggestion:
        diff > 0
          ? "If a delivery was received but not logged, record it as a Stock In (or log an adjustment). If the stored number is wrong, align it with the ledger."
          : "If items were used but not logged, record the Stock Out (or log an adjustment). If the stored number is wrong, align it with the ledger.",
      amount: diff,
    });
  }

  // 3. Possible duplicates (reported even when balanced)
  const duplicates = findDuplicates(events);
  if (duplicates.length) {
    const extra = duplicates.reduce((sum, g) => sum + g.quantity * (g.items.length - 1), 0);
    causes.push({
      code: "possible_duplicates",
      likelihood: "possible",
      title: "Possible duplicate entries",
      detail: `${duplicates.length} group(s) of entries with the same quantity logged within 5 minutes of each other (${extra} ${unit} would be counted twice if they are double entries).`,
      suggestion: "Open the product's History and edit the duplicate entry to 0 (voids it, with a reason) if it was entered twice.",
      groups: duplicates.map((g) => ({ type: g.type, quantity: g.quantity, items: g.items.map(brief) })),
    });
  }

  // 4. Historical negative-stock drift
  const { dips } = replayBalance(events);
  if (dips.length) {
    const first = dips[0];
    const lowest = dips.reduce((min, d) => (d.balance < min.balance ? d : min), dips[0]);
    causes.push({
      code: "negative_drift",
      likelihood: "possible",
      title: "Stock went below zero in the past",
      detail: `Replaying the history, the balance dropped below zero ${dips.length} time(s), first on ${new Date(first.event.date).toISOString().slice(0, 10)} (balance ${first.balance} ${unit}); lowest ${lowest.balance} ${unit}. A usage was logged before the delivery that covered it.`,
      suggestion: "Check for a missing or late-dated Stock In before that date, or a Stock Out logged with the wrong date or quantity, and edit it.",
      firstNegative: { ...brief(first.event), balance: first.balance },
      lowestBalance: lowest.balance,
      occurrences: dips.length,
    });
  }

  return {
    product: {
      _id: product._id,
      name: product.name,
      unit,
      isActive: product.isActive !== false,
      createdAt,
    },
    ledger: {
      totalIn: ledger.totalIn,
      totalOut: ledger.totalOut,
      totalAdjusted: ledger.totalAdjusted,
      quantity: ledger.quantity,
    },
    reconciliation: recon,
    status: recon.balanced ? "balanced" : "mismatch",
    causes,
    movementCount: events.length,
  };
}

const readReason = (reason) => {
  const text = typeof reason === "string" ? reason.trim() : "";
  if (text.length < REASON_MIN) throw new ReconcileError(400, `A reason of at least ${REASON_MIN} characters is required.`);
  if (text.length > REASON_MAX) throw new ReconcileError(400, `Reason must be at most ${REASON_MAX} characters.`);
  return text;
};

// POST body: { action, reason, quantityDelta?, expectedCurrent?, expectedLedger? }
//   action "align_stock":     stored stock := ledger (no ledger change),
//                             audited as cache_reconcile
//   action "log_adjustment":  adds a stock_adjustment of quantityDelta
//                             (default: stored − ledger, i.e. the ledger
//                             accepts the stored count) and stores the new
//                             ledger balance
// expectedCurrent / expectedLedger (the values the user saw) make the call
// fail with 409 if the stock changed in the meantime.
async function reconcileProduct(productId, body = {}) {
  if (!mongoose.Types.ObjectId.isValid(productId)) throw new ReconcileError(400, "Invalid product ID.");
  const { action } = body;
  if (!["align_stock", "log_adjustment"].includes(action)) {
    throw new ReconcileError(400, 'action must be "align_stock" or "log_adjustment".');
  }
  const reason = readReason(body.reason);

  const product = await Product.findById(productId).lean();
  if (!product) throw new ReconcileError(404, "Product not found.");
  const unit = productUnitOf(product);
  const ledger = (await computeLedger([product])).get(String(product._id));
  const recon = reconciliationOf(product, ledger.quantity);

  const sameAs = (expected, actual) =>
    expected === undefined || expected === null || expected === "" || roundQty(Number(expected)) === actual;
  if (!sameAs(body.expectedCurrent, recon.current) || !sameAs(body.expectedLedger, recon.expected)) {
    throw new ReconcileError(409, "The stock changed since you opened this check. Reload and try again.", {
      reconciliation: recon,
    });
  }

  if (action === "align_stock") {
    if (recon.balanced) throw new ReconcileError(400, "Already balanced: nothing to align.");
    const updated = await Product.updateOne(
      { _id: product._id, quantity: product.quantity },
      { $set: { quantity: recon.expected } },
    );
    if (updated.matchedCount !== 1) throw new ReconcileError(409, "The stock changed while saving. Reload and try again.");
    await Adjustment.create({
      product: product._id,
      kind: "cache_reconcile",
      previousCachedQuantity: recon.current,
      newCachedQuantity: recon.expected,
      ledgerQuantity: recon.expected,
      unit,
      reason,
    });
    return {
      message: `Stored stock of "${product.name}" aligned with the ledger: ${recon.current} → ${recon.expected} ${unit}.`,
      reconciliation: reconciliationOf({ quantity: recon.expected }, recon.expected),
    };
  }

  // log_adjustment
  const raw = body.quantityDelta;
  const delta = raw === undefined || raw === null || raw === "" ? recon.difference : roundQty(Number(raw));
  if (delta === null || !Number.isFinite(delta) || delta === 0) {
    throw new ReconcileError(400, "Enter a non-zero adjustment quantity (+ adds stock, − removes stock).");
  }
  const newLedger = roundQty(recon.expected + delta);
  if (newLedger < 0) {
    throw new ReconcileError(400, `This adjustment would make stock negative (${recon.expected} ${signed(delta)} = ${newLedger} ${unit}).`);
  }
  const adjustment = await Adjustment.create({
    product: product._id,
    kind: "stock_adjustment",
    date: new Date(),
    quantityDelta: delta,
    unit,
    previousCachedQuantity: recon.current,
    newCachedQuantity: newLedger,
    ledgerQuantity: recon.expected,
    reason,
  });

  // Concurrent stock out could have used the same stock in between.
  const after = (await computeLedger([product])).get(String(product._id)).quantity;
  if (after < 0) {
    await Adjustment.deleteOne({ _id: adjustment._id });
    throw new ReconcileError(409, "Stock changed while saving. Reload and try again.");
  }
  await Product.updateOne({ _id: product._id }, { $set: { quantity: after } });
  return {
    message: `Adjustment of ${signed(delta)} ${unit} logged for "${product.name}". Stock is now ${after} ${unit}.`,
    adjustment,
    reconciliation: reconciliationOf({ quantity: after }, after),
  };
}

module.exports = { diagnoseProduct, reconcileProduct, ReconcileError, findDuplicates, replayBalance, DUPLICATE_WINDOW_MS };
