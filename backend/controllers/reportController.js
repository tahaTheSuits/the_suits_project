const mongoose = require("mongoose");
const StockOut = require("../models/stockOutModel");
const StockIn = require("../models/stockInModel");
const Product = require("../models/productModel");

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

// --- Stock Out Reports ---

exports.getDailyReport = async (req, res) => {
  try {
    const { start, end } = getDayRange(new Date());
    const dailyReport = await StockOut.aggregate([
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
          unit: { $arrayElemAt: ["$productDetails.unit", 0] },
          quantity: 1,
          usedBy: 1,
          floor: 1,
          date: 1,
        },
      },
      { $sort: { productName: 1, floor: 1, date: 1 } },
    ]);

    res.json(dailyReport);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch daily report" });
  }
};

exports.getWeeklyReport = async (req, res) => {
  try {
    const { start, end } = getWeekRange(new Date());
    const weeklyReport = await StockOut.aggregate([
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
          unit: { $arrayElemAt: ["$productDetails.unit", 0] },
          quantity: 1,
          usedBy: 1,
          floor: 1,
          date: 1,
        },
      },
      { $sort: { productName: 1, floor: 1, date: 1 } },
    ]);
    res.json(weeklyReport);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch weekly report" });
  }
};

// Daily Stock In Report
exports.getDailyStockInReport = async (req, res) => {
  try {
    const today = new Date();
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setHours(23, 59, 59, 999);

    const dailyStockInReport = await StockIn.aggregate([
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
          unit: { $arrayElemAt: ["$productDetails.unit", 0] },
          quantity: 1,
          source: 1,
          date: 1,
        },
      },
      { $sort: { productName: 1, date: 1 } },
    ]);

    res.json(dailyStockInReport);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch daily stock in report" });
  }
};

// Weekly Stock In Report
exports.getWeeklyStockInReport = async (req, res) => {
  try {
    const today = new Date();
    const day = today.getDay();
    const diffToSun = today.getDate() - day;
    const start = new Date(today.setDate(diffToSun));
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    const weeklyStockInReport = await StockIn.aggregate([
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
          unit: { $arrayElemAt: ["$productDetails.unit", 0] },
          quantity: 1,
          source: 1,
          date: 1,
        },
      },
      { $sort: { productName: 1, date: 1 } },
    ]);

    res.json(weeklyStockInReport);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch weekly stock in report" });
  }
};

// Stock In Report by Date Range
exports.getStockInByDateRange = async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ message: "from and to dates are required" });

    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);

    const report = await StockIn.aggregate([
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
          unit: { $arrayElemAt: ["$productDetails.unit", 0] },
          quantity: 1,
          source: 1,
          date: 1,
        },
      },
      { $sort: { date: 1 } },
    ]);

    res.json(report);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch stock in report" });
  }
};

// Stock Out Report by Date Range
exports.getStockOutByDateRange = async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ message: "from and to dates are required" });

    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);

    const report = await StockOut.aggregate([
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
          unit: { $arrayElemAt: ["$productDetails.unit", 0] },
          quantity: 1,
          floor: 1,
          usedBy: 1,
          date: 1,
        },
      },
      { $sort: { date: 1 } },
    ]);

    res.json(report);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch stock out report" });
  
}
};