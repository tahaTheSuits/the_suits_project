const StockOut = require("../models/stockOutModel");
const StockIn = require("../models/stockInModel");
const { runMovementReport } = require("../utils/reportPipeline");
const { getCurrentStock } = require("../utils/stock");

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

const reportHandler = (Model, movementType, getRange, sort, errorMessage) => async (req, res) => {
  try {
    const range = getRange(req);
    if (!range) {
      return res.status(400).json({ message: "Valid from and to dates are required" });
    }
    res.json(await runMovementReport(Model, movementType, range, sort));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: errorMessage });
  }
};

const today = () => getDayRange(new Date());
const thisWeek = () => getWeekRange(new Date());

// --- Stock Out Reports ---
exports.getDailyReport = reportHandler(
  StockOut, "out", today, { productName: 1, floor: 1, date: 1 }, "Failed to fetch daily report",
);

exports.getWeeklyReport = reportHandler(
  StockOut, "out", thisWeek, { productName: 1, floor: 1, date: 1 }, "Failed to fetch weekly report",
);

// --- Stock In Reports ---
exports.getDailyStockInReport = reportHandler(
  StockIn, "in", today, { productName: 1, date: 1 }, "Failed to fetch daily stock in report",
);

exports.getWeeklyStockInReport = reportHandler(
  StockIn, "in", thisWeek, { productName: 1, date: 1 }, "Failed to fetch weekly stock in report",
);

// --- Date range reports ---
exports.getStockInByDateRange = reportHandler(
  StockIn, "in", getRequestedRange, { date: 1 }, "Failed to fetch stock in report",
);

exports.getStockOutByDateRange = reportHandler(
  StockOut, "out", getRequestedRange, { date: 1 }, "Failed to fetch stock out report",
);


// --- Current Stock ---
// GET /api/reports/current-stock[?includeArchived=true]
// True ledger balance per product (StockIn - StockOut, corrections applied),
// in the product's unit. Same rows as GET /api/inventory.
const summarize = (rows) => ({
  products: rows.length,
  out: rows.filter((r) => r.status === "out").length,
  low: rows.filter((r) => r.status === "low").length,
  ok: rows.filter((r) => r.status === "ok").length,
  withUnitConflicts: rows.filter((r) => r.unitConflicts.length > 0).length,
});

exports.buildCurrentStockReport = async ({ includeArchived = false } = {}) => {
  const rows = await getCurrentStock({ includeArchived });
  return { generatedAt: new Date(), includeArchived, summary: summarize(rows), rows };
};

exports.getCurrentStockReport = async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === "true";
    res.json(await exports.buildCurrentStockReport({ includeArchived }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch current stock report" });
  }
};
