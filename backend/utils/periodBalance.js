// Period stock balance per product for date-filtered reports:
//
//   opening  = ledger balance before the period starts
//   closing  = opening + period In − period Out + period adjustments
//
// `closing` is verified against an independent calculation of the ledger up
// to the end of the period. When the period reaches today, the closing
// balance is also compared with the stored stock (Product.quantity), so the
// same Balanced / Mismatch status as the inventory is shown.
const Product = require("../models/productModel");
const StockIn = require("../models/stockInModel");
const StockOut = require("../models/stockOutModel");
const Adjustment = require("../models/adjustmentModel");
const { latestCorrectionLookup, EFFECTIVE_QUANTITY, productUnitOf, reconciliationOf, roundQty } = require("./stock");
const { resolveExportRange } = require("./exportHelpers");

const sumIf = (cond, value) => ({ $sum: { $cond: [cond, value, 0] } });

const movementTotals = (Model, movementType, { start, end }) =>
  Model.aggregate([
    { $match: { date: { $lte: end } } },
    latestCorrectionLookup(movementType),
    { $addFields: { qty: EFFECTIVE_QUANTITY } },
    {
      $group: {
        _id: "$product",
        before: sumIf({ $lt: ["$date", start] }, "$qty"),
        period: sumIf({ $gte: ["$date", start] }, "$qty"),
        upToEnd: { $sum: "$qty" },
        periodCount: sumIf({ $gte: ["$date", start] }, 1),
      },
    },
  ]);

const adjustmentTotals = ({ start, end }) =>
  Adjustment.aggregate([
    { $match: { kind: "stock_adjustment" } },
    { $addFields: { at: { $ifNull: ["$date", "$createdAt"] } } },
    { $match: { at: { $lte: end } } },
    {
      $group: {
        _id: "$product",
        before: sumIf({ $lt: ["$at", start] }, "$quantityDelta"),
        period: sumIf({ $gte: ["$at", start] }, "$quantityDelta"),
        upToEnd: { $sum: "$quantityDelta" },
        periodCount: sumIf({ $gte: ["$at", start] }, 1),
      },
    },
  ]);

async function buildPeriodBalance(query = {}) {
  const range = resolveExportRange(query);
  const now = new Date();
  const reachesNow = range.end >= now;

  const [ins, outs, adjs, products] = await Promise.all([
    movementTotals(StockIn, "in", range),
    movementTotals(StockOut, "out", range),
    adjustmentTotals(range),
    Product.find().lean(),
  ]);
  const index = (rows) => new Map(rows.map((r) => [String(r._id), r]));
  const [inMap, outMap, adjMap] = [index(ins), index(outs), index(adjs)];
  const zero = { before: 0, period: 0, upToEnd: 0, periodCount: 0 };

  const rows = products
    .map((product) => {
      const id = String(product._id);
      const i = inMap.get(id) || zero;
      const o = outMap.get(id) || zero;
      const a = adjMap.get(id) || zero;
      const opening = roundQty(i.before - o.before + a.before);
      const periodIn = roundQty(i.period);
      const periodOut = roundQty(o.period);
      const periodAdjusted = roundQty(a.period);
      const closing = roundQty(opening + periodIn - periodOut + periodAdjusted);
      const closingLedger = roundQty(i.upToEnd - o.upToEnd + a.upToEnd);
      const activity = i.periodCount + o.periodCount + a.periodCount;
      const current = reachesNow ? reconciliationOf(product, closing) : null;
      return {
        _id: product._id,
        product: product.name,
        unit: productUnitOf(product),
        isActive: product.isActive !== false,
        opening,
        periodIn,
        periodOut,
        periodAdjusted,
        closing,
        movements: activity,
        // opening + period movements must equal the ledger at the end.
        periodVerified: closing === closingLedger,
        closingLedger,
        // Only when the period reaches today: closing vs stored stock.
        reconciliation: current,
        balanced: closing === closingLedger && (!current || current.balanced),
      };
    })
    // Products with activity in the period, a balance, or a mismatch.
    .filter((r) => r.movements > 0 || r.opening !== 0 || r.closing !== 0 || (r.reconciliation && !r.reconciliation.balanced))
    .sort((a, b) => a.product.localeCompare(b.product, "en", { sensitivity: "base" }));

  return {
    from: range.allDates ? null : range.start,
    to: range.allDates ? null : range.end,
    label: range.label,
    slug: range.slug,
    comparesStoredStock: reachesNow,
    summary: {
      products: rows.length,
      balanced: rows.filter((r) => r.balanced).length,
      mismatched: rows.filter((r) => !r.balanced).length,
    },
    rows,
  };
}

module.exports = { buildPeriodBalance };
