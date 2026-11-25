// Shared aggregation for every movement report and export.
// Each movement appears ONCE, in its original date bucket, with its
// effective (latest corrected) quantity. Corrections are never added as
// extra rows, so totals cannot double-count; instead each row carries
// `corrected`, `originalQuantity` and `originalUnit` for traceability.
// `sort` may use sortName (lower-cased product name) and/or date.
const { normalizeUnit } = require("./units");
const { latestCorrectionLookup, EFFECTIVE_QUANTITY, IS_CORRECTED } = require("./stock");

// Only fields that exist in the schemas. (Floor / Used By were never stored,
// so they are no longer projected or exported as empty columns.)
const IN_FIELDS = { source: 1 };

const buildMovementPipeline = (movementType, { start, end }, sort) => [
  { $match: { date: { $gte: start, $lte: end } } },
  {
    $lookup: {
      from: "products",
      localField: "product",
      foreignField: "_id",
      as: "productDetails",
    },
  },
  latestCorrectionLookup(movementType),
  {
    $project: {
      productName: { $arrayElemAt: ["$productDetails.name", 0] },
      unit: { $ifNull: [{ $arrayElemAt: ["$productDetails.unit", 0] }, "$unit"] },
      productArchived: {
        $eq: [{ $arrayElemAt: ["$productDetails.isActive", 0] }, false],
      },
      quantity: EFFECTIVE_QUANTITY,
      originalQuantity: "$quantity",
      originalUnit: "$unit",
      corrected: IS_CORRECTED,
      correctionReason: { $arrayElemAt: ["$latestCorrection.reason", 0] },
      date: 1,
      ...(movementType === "in" ? IN_FIELDS : {}),
    },
  },
  // Case-insensitive product sort ("apple" next to "Apple", not after "Z").
  { $addFields: { sortName: { $toLower: { $ifNull: ["$productName", ""] } } } },
  { $sort: { ...sort, _id: 1 } },
  { $project: { sortName: 0 } },
];

// Legacy "galon" -> "gallon" so the UI never sees two spellings.
const normalizeRows = (rows) =>
  rows.map((row) => ({
    ...row,
    unit: normalizeUnit(row.unit) || row.unit,
    originalUnit: normalizeUnit(row.originalUnit) || row.originalUnit,
  }));

const runMovementReport = async (Model, movementType, range, sort) =>
  normalizeRows(await Model.aggregate(buildMovementPipeline(movementType, range, sort)));

// Short human-readable note for exports, e.g. "corrected from 8 pcs: typo".
const correctionNote = (row) => {
  if (!row.corrected) return "";
  const from = `${row.originalQuantity} ${row.originalUnit || ""}`.trim();
  return `corrected from ${from}${row.correctionReason ? `: ${row.correctionReason}` : ""}`;
};

module.exports = { buildMovementPipeline, runMovementReport, normalizeRows, correctionNote };
