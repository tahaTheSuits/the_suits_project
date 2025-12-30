const StockOut = require("../models/stockOutModel");
const Product = require("../models/productModel");
const mongoose = require("mongoose");

exports.getDailyReport = async (req, res) => {
  try {
    // اليوم الحالي
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // aggregation لكل StockOut لليوم
    const report = await StockOut.aggregate([
      {
        $match: {
          createdAt: { $gte: startOfDay, $lte: endOfDay }
        }
      },
      {
        $lookup: {
          from: "products",
          localField: "product",
          foreignField: "_id",
          as: "productInfo"
        }
      },
      { $unwind: "$productInfo" },
      {
        $group: {
          _id: "$product",
          productName: { $first: "$productInfo.name" },
          totalUsed: { $sum: "$quantity" },
          users: { $addToSet: "$usedBy" },
          unit: r.product.unit,
        }
      }
    ]);

    res.json(report);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};