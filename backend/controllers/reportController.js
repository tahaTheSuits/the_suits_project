const StockOut = require("../models/stockOutModel");
const StockIn = require("../models/stockInModel");
const { normalizeUnit } = require("../utils/units");

// Helpers
const getDayRange = (date) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const getWeekRange = (date) => {
  const d = new Date(date);
  const day = d.getDay(); // 0 = الأحد
  const diffToSun = d.getDate() - day;
  const start = new Date(d.setDate(diffToSun));
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const getRequestedRange = (req) => {
  const { from, to } = req.query;
  if (!from || !to) return null;
  const start = new Date(from);
  const end = new Date(to);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

// Movements of archived products stay in reports; they are flagged instead.
const buildPipeline = ({ start, end }, extraFields, sort) => [
  { $match: { date: { $gte: start, $lte: end } } },
  {
    $lookup: {
      from: "products",
      localField: "product",
      foreignField: "_id",
      as: "productDetails",
    },
  },
  {
    $project: {
      productName: { $arrayElemAt: ["$productDetails.name", 0] },
      unit: { $ifNull: [{ $arrayElemAt: ["$productDetails.unit", 0] }, "$unit"] },
      productArchived: {
        $eq: [{ $arrayElemAt: ["$productDetails.isActive", 0] }, false],
      },
      quantity: 1,
      date: 1,
      ...extraFields,
    },
  },
  { $sort: sort },
];

const OUT_FIELDS = { usedBy: 1, floor: 1 };
const IN_FIELDS = { source: 1 };

// Legacy "galon" -> "gallon" so the UI never sees two spellings.
const normalizeRows = (rows) =>
  rows.map((row) => ({ ...row, unit: normalizeUnit(row.unit) || row.unit }));

const reportHandler = (Model, getRange, extraFields, sort, errorMessage) => async (req, res) => {
  try {
    const range = getRange(req);
    if (!range) {
      return res.status(400).json({ message: "Valid from and to dates are required" });
    }
    const rows = await Model.aggregate(buildPipeline(range, extraFields, sort));
    res.json(normalizeRows(rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: errorMessage });
  }
};

const today = () => getDayRange(new Date());
const thisWeek = () => getWeekRange(new Date());

// --- Stock Out Reports ---
exports.getDailyReport = reportHandler(
  StockOut, today, OUT_FIELDS, { productName: 1, floor: 1, date: 1 }, "Failed to fetch daily report",
);

exports.getWeeklyReport = reportHandler(
  StockOut, thisWeek, OUT_FIELDS, { productName: 1, floor: 1, date: 1 }, "Failed to fetch weekly report",
);

// --- Stock In Reports ---
exports.getDailyStockInReport = reportHandler(
  StockIn, today, IN_FIELDS, { productName: 1, date: 1 }, "Failed to fetch daily stock in report",
);

exports.getWeeklyStockInReport = reportHandler(
  StockIn, thisWeek, IN_FIELDS, { productName: 1, date: 1 }, "Failed to fetch weekly stock in report",
);

// --- Date range reports ---
exports.getStockInByDateRange = reportHandler(
  StockIn, getRequestedRange, IN_FIELDS, { date: 1 }, "Failed to fetch stock in report",
);

exports.getStockOutByDateRange = reportHandler(
  StockOut, getRequestedRange, { floor: 1, usedBy: 1 }, { date: 1 }, "Failed to fetch stock out report",
);
