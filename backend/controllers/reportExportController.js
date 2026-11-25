const ExcelJS = require("exceljs");
const StockOut = require("../models/stockOutModel");
const StockIn = require("../models/stockInModel");
const PDFDocument = require("pdfkit");
const { runMovementReport, correctionNote } = require("../utils/reportPipeline");
const { buildCurrentStockReport } = require("./reportController");
const { drawTable } = require("../utils/pdfTable");

// NOTE (Phase 3): the stock in/out exports keep their existing layout and
// date-range handling. Phase 2 only switches them to the shared pipeline so
// they show corrected quantities (with a correction note) like the reports.

// ================= EXPORT STOCK OUT EXCEL =================
exports.exportStockOutExcel = async (req, res) => {
  try {
    const { from, to } = req.query;

    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);

    const data = await runMovementReport(StockOut, "out", { start, end }, { date: 1 });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Stock Out Report");

    sheet.columns = [
      { header: "Date", key: "date", width: 20 },
      { header: "Product", key: "productName", width: 25 },
      { header: "Quantity", key: "quantity", width: 15 },
      { header: "Floor", key: "floor", width: 20 },
      { header: "Used By", key: "usedBy", width: 25 },
      { header: "Correction", key: "correction", width: 40 },
    ];

    data.forEach((item) => {
      sheet.addRow({
        date: item.date.toISOString().split("T")[0],
        productName: item.productName,
        quantity: item.quantity,
        floor: item.floor,
        usedBy: item.usedBy || "-",
        correction: correctionNote(item),
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

    const data = await runMovementReport(StockIn, "in", { start, end }, { date: 1 });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Stock In Report");

    sheet.columns = [
      { header: "Date", key: "date", width: 20 },
      { header: "Product", key: "productName", width: 25 },
      { header: "Quantity", key: "quantity", width: 15 },
      { header: "Source", key: "source", width: 25 },
      { header: "Correction", key: "correction", width: 40 },
    ];

    data.forEach((item) => {
      sheet.addRow({
        date: item.date.toISOString().split("T")[0],
        productName: item.productName,
        quantity: item.quantity,
        source: item.source || "-",
        correction: correctionNote(item),
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
exports.exportStockOutPDF = async (req, res) => {
  try {
    // تحويل القيم من query params إلى Date
    const from = req.query.from ? new Date(req.query.from) : new Date("2000-01-01");
    const to = req.query.to ? new Date(req.query.to) : new Date();

    // تحقق من صحة التاريخ
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    const stockOutData = await runMovementReport(StockOut, "out", { start: from, end: to }, { date: 1 });

    // إنشاء PDF
    const doc = new PDFDocument({ margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=stock-out-report.pdf");

    doc.pipe(res);

    doc.fontSize(20).text("Stock Out Report", { align: "center" });
    doc.moveDown();

    stockOutData.forEach((item) => {
      const dateStr = item.date ? item.date.toLocaleDateString() : "Unknown Date";
      const productName = item.productName || "Unknown Product";
      const quantity = item.quantity || 0;
      const floor = item.floor || "-";
      const usedBy = item.usedBy || "-";
      const note = correctionNote(item);

      doc.fontSize(12).text(
       ` ${dateStr} | ${productName} | Qty: ${quantity} | Floor: ${floor} | Used By: ${usedBy}${note ? ` | ${note}` : ""}`
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

    const stockInData = await runMovementReport(StockIn, "in", { start: from, end: to }, { date: 1 });

    const doc = new PDFDocument({ margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=stock-in-report.pdf");

    doc.pipe(res);

    doc.fontSize(18).text("Stock In Report", { align: "center" });
    doc.moveDown();

    stockInData.forEach((item) => {
      const dateStr = item.date ? item.date.toLocaleDateString() : "Unknown Date";
      const productName = item.productName || "Unknown Product";
      const source = item.source || "-";
      const note = correctionNote(item);

      doc.fontSize(12).text(
        `${dateStr} | ${productName} | Qty: ${item.quantity} | ${source}${note ? ` | ${note}` : ""}
      `);
    });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "PDF export failed", error: err.message });
  }
};

// ================= CURRENT STOCK (PDF / EXCEL) =================
// GET /api/export/current-stock/{pdf|excel}[?includeArchived=true]

const STATUS_TEXT = { out: "Out of stock", low: "Low", ok: "OK" };

const conflictText = (row) => {
  if (!row.unitConflicts.length) return "";
  const count = row.unitConflicts.reduce((sum, c) => sum + c.count, 0);
  const detail = row.unitConflicts.map((c) => `${c.quantity} ${c.unit} (${c.direction})`).join(", ");
  return `${count} movement(s) in other units: ${detail}`;
};

const CURRENT_STOCK_COLUMNS = [
  { header: "Product", width: 3, value: (r) => r.product + (r.isActive ? "" : " (archived)") },
  { header: "Unit", width: 1, value: (r) => r.unit },
  { header: "Available", width: 1.2, align: "right", value: (r) => r.quantity },
  { header: "Min Stock", width: 1.4, align: "right", value: (r) => `${r.minStock}${r.minStockIsDefault ? " (default)" : ""}` },
  { header: "Status", width: 1.3, value: (r) => STATUS_TEXT[r.status] || r.status },
  { header: "Unit conflict", width: 3, value: (r) => conflictText(r) || "No" },
];

// Local calendar date, e.g. 2026-11-25 (server time zone).
const isoDate = (date) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const currentStockFilename = (report, ext) =>
  `current-stock${report.includeArchived ? "-with-archived" : ""}-${isoDate(report.generatedAt)}.${ext}`;

exports.exportCurrentStockExcel = async (req, res) => {
  try {
    const report = await buildCurrentStockReport({ includeArchived: req.query.includeArchived === "true" });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Current Stock");
    sheet.columns = [
      { header: "Product", key: "product", width: 32 },
      { header: "Unit", key: "unit", width: 10 },
      { header: "Available", key: "quantity", width: 12 },
      { header: "Min Stock", key: "minStock", width: 12 },
      { header: "Min Stock Source", key: "minStockSource", width: 18 },
      { header: "Status", key: "status", width: 14 },
      { header: "Archived", key: "archived", width: 10 },
      { header: "Unit Conflict", key: "unitConflict", width: 50 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    report.rows.forEach((row) => {
      sheet.addRow({
        product: row.product,
        unit: row.unit,
        quantity: row.quantity,
        minStock: row.minStock,
        minStockSource: row.minStockIsDefault ? "default" : "set",
        status: STATUS_TEXT[row.status] || row.status,
        archived: row.isActive ? "No" : "Yes",
        unitConflict: conflictText(row) || "No",
      });
    });

    sheet.addRow([]);
    sheet.addRow([`Generated ${report.generatedAt.toISOString()}`]);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=${currentStockFilename(report, "xlsx")}`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ message: "Excel export failed" });
  }
};

exports.exportCurrentStockPDF = async (req, res) => {
  let report;
  try {
    report = await buildCurrentStockReport({ includeArchived: req.query.includeArchived === "true" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "PDF export failed" });
  }

  const doc = new PDFDocument({ margin: 40, size: "A4", layout: "landscape" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=${currentStockFilename(report, "pdf")}`);
  doc.pipe(res);

  const { summary } = report;
  doc.font("Helvetica-Bold").fontSize(18).text("Current Stock Report", { align: "center" });
  doc.font("Helvetica").fontSize(10).fillColor("#596460").text(
    `Generated ${report.generatedAt.toUTCString()}${report.includeArchived ? " - includes archived products" : ""}`,
    { align: "center" },
  );
  doc.moveDown(0.4).text(
    `${summary.products} products - ${summary.out} out of stock - ${summary.low} low - ${summary.ok} OK` +
      (summary.withUnitConflicts ? ` - ${summary.withUnitConflicts} with unit conflicts` : ""),
    { align: "center" },
  );
  doc.fillColor("#000000").moveDown(1);

  if (report.rows.length === 0) {
    doc.fontSize(12).text("No products.", { align: "center" });
  } else {
    drawTable(doc, { columns: CURRENT_STOCK_COLUMNS, rows: report.rows });
  }
  doc.end();
};

// ================= STOCK OUT REPORT WITH PAGINATION =================
// (unchanged, unused by the frontend; uses raw quantities — see Phase 3 notes)
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