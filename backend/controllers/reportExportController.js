const ExcelJS = require("exceljs");
const StockOut = require("../models/stockOutModel");
const StockIn = require("../models/stockInModel");
const mongoose = require("mongoose");
const PDFDocument = require("pdfkit");
const path = require("path");

// ================= EXPORT STOCK OUT EXCEL =================
exports.exportStockOutExcel = async (req, res) => {
  try {
    const { from, to } = req.query;

    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);

    const data = await StockOut.aggregate([
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
          quantity: 1,
          floor: 1,
          usedBy: 1,
          date: 1,
        },
      },
      { $sort: { date: 1 } },
    ]);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Stock Out Report");

    sheet.columns = [
      { header: "Date", key: "date", width: 20 },
      { header: "Product", key: "productName", width: 25 },
      { header: "Quantity", key: "quantity", width: 15 },
      { header: "Floor", key: "floor", width: 20 },
      { header: "Used By", key: "usedBy", width: 25 },
    ];

    data.forEach((item) => {
      sheet.addRow({
        date: item.date.toISOString().split("T")[0],
        productName: item.productName,
        quantity: item.quantity,
        floor: item.floor,
        usedBy: item.usedBy || "-",
      });
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=stock-out-report.xlsx"
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Excel export failed" });
  }
};

// ================= EXPORT STOCK IN EXCEL =================
exports.exportStockInExcel = async (req, res) => {
  try {
    const { from, to } = req.query;

    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);

    const data = await StockIn.aggregate([
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
          quantity: 1,
          source: 1,
          date: 1,
        },
      },
      { $sort: { date: 1 } },
    ]);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Stock In Report");

    sheet.columns = [
      { header: "Date", key: "date", width: 20 },
      { header: "Product", key: "productName", width: 25 },
      { header: "Quantity", key: "quantity", width: 15 },
      { header: "Source", key: "source", width: 25 },
    ];

    data.forEach((item) => {
      sheet.addRow({
        date: item.date.toISOString().split("T")[0],
        productName: item.productName,
        quantity: item.quantity,
        source: item.source || "-",
      });
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=stock-in-report.xlsx"
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Excel export failed" });
  }
};

// ================= EXPORT STOCK OUT PDF =================
// Export Stock Out Report to PDF
// Export Stock Out Report to PDF
exports.exportStockOutPDF = async (req, res) => {
  try {
    // تحويل القيم من query params إلى Date
    const from = req.query.from ? new Date(req.query.from) : new Date("2000-01-01");
    const to = req.query.to ? new Date(req.query.to) : new Date();

    // تحقق من صحة التاريخ
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    // جلب البيانات من المونغو مع populate لجلب اسم المنتج
    const stockOutData = await StockOut.find({
      date: { $gte: from, $lte: to },
    })
      .populate("product") // ✅ populate للحصول على اسم المنتج
      .sort({ date: 1 });

    // إنشاء PDF
    const doc = new PDFDocument({ margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=stock-out-report.pdf");

    doc.pipe(res);

    doc.fontSize(20).text("Stock Out Report", { align: "center" });
    doc.moveDown();

    stockOutData.forEach((item) => {
      const dateStr = item.date ? item.date.toLocaleDateString() : "Unknown Date";
      const productName = item.product ? item.product.name : "Unknown Product";
      const quantity = item.quantity || 0;
      const floor = item.floor || "-";
      const usedBy = item.usedBy || "-";

      doc.fontSize(12).text(
       ` ${dateStr} | ${productName} | Qty: ${quantity} | Floor: ${floor} | Used By: ${usedBy}`
      );
    });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "PDF export failed", error: err.message });
}
};
// ================= EXPORT STOCK IN PDF =================
exports.exportStockInPDF = async (req, res) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date("2000-01-01");
    const to = req.query.to ? new Date(req.query.to) : new Date();
    to.setHours(23, 59, 59, 999);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    const stockInData = await StockIn.find({
      date: { $gte: from, $lte: to },
    })
      .populate("product")
      .sort({ date: 1 });

    const doc = new PDFDocument({ margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=stock-in-report.pdf");

    doc.pipe(res);

    doc.fontSize(18).text("Stock In Report", { align: "center" });
    doc.moveDown();

    stockInData.forEach((item) => {
      const dateStr = item.date ? item.date.toLocaleDateString() : "Unknown Date";
      const productName = item.product?.name || "Unknown Product";
      const source = item.source || "-";

      doc.fontSize(12).text(
        `${dateStr} | ${productName} | Qty: ${item.quantity} | ${source}
      `);
    });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "PDF export failed", error: err.message });
  }
};

// ================= STOCK OUT REPORT WITH PAGINATION =================
exports.getStockOutReport = async (req, res) => {
  try {
    let { from, to, page = 1, limit = 20 } = req.query;

    const start = from
      ? new Date(from)
      : new Date(new Date().setHours(0, 0, 0, 0));
    const end = to
      ? new Date(to)
      : new Date(new Date().setHours(23, 59, 59, 999));

    page = Number(page);
    limit = Number(limit);

    const filter = {
      createdAt: { $gte: start, $lte: end },
    };

    const data = await StockOut.find(filter)
      .populate("product", "name sku")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const totalCount = await StockOut.countDocuments(filter);

    const totalQuantity = await StockOut.aggregate([
      { $match: filter },
      { $group: { _id: null, total: { $sum: "$quantity" } } },
    ]);

    res.json({
      page,
      totalPages: Math.ceil(totalCount / limit),
      totalCount,
      totalQuantity: totalQuantity[0]?.total || 0,
      data,
    });
  } catch (err) {
    console.error("StockOut report error:", err);
    res.status(500).json({ message: err.message });
}
};