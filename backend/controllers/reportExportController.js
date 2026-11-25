// PDF / Excel exports.
//   GET /api/export/{stock-in|stock-out}/{pdf|excel}?from=YYYY-MM-DD&to=YYYY-MM-DD
//   GET /api/export/current-stock/{pdf|excel}?includeArchived=true
//
// Every export: builds the data first, renders the file fully in memory,
// then sends it with a descriptive filename (never "undefined"). Errors are
// returned as JSON with a proper status before anything is streamed.
// Dates may be omitted (all dates) or given individually; ranges are
// inclusive of the whole end day, for stock in AND stock out.
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const StockOut = require("../models/stockOutModel");
const StockIn = require("../models/stockInModel");
const { runMovementReport, correctionNote } = require("../utils/reportPipeline");
const { buildCurrentStockReport } = require("./reportController");
const { drawReportHeader, drawTable, addPageFooters } = require("../utils/pdfTable");
const {
  resolveExportRange,
  formatDate,
  formatDateTime,
  isoToday,
  excelDate,
  totalsByUnit,
  formatTotals,
  pdfToBuffer,
  sendFile,
  exportHandler,
} = require("../utils/exportHelpers");

const HEADER_FILL = "FF5F756D";

// ================= MOVEMENT EXPORTS (stock in / stock out) =================

const MOVEMENT_EXPORTS = {
  in: { Model: StockIn, title: "Stock In Report", file: "stock-in-report", sheet: "Stock In" },
  out: { Model: StockOut, title: "Stock Out Report", file: "stock-out-report", sheet: "Stock Out" },
};

// Same order as the on-screen report tables: product name, then date.
const MOVEMENT_SORT = { sortName: 1, date: 1 };

const productLabel = (row) =>
  `${row.productName || "Unknown product"}${row.productArchived ? " (archived)" : ""}`;

async function loadMovementExport(movementType, query) {
  const config = MOVEMENT_EXPORTS[movementType];
  const range = resolveExportRange(query);
  const rows = await runMovementReport(config.Model, movementType, range, MOVEMENT_SORT);
  const totals = totalsByUnit(rows);
  const correctedCount = rows.filter((r) => r.corrected).length;

  // Columns: only what the data actually has. Floor / Used By are not part
  // of the schema, so they are no longer exported as empty columns.
  const columns = [
    { header: "Date", width: 1.3, excelWidth: 12, value: (r) => formatDate(r.date), excel: (r) => excelDate(r.date), numFmt: "dd/mm/yyyy" },
    { header: "Product", width: 3.2, excelWidth: 32, value: productLabel },
    { header: "Quantity", width: 1.1, excelWidth: 11, align: "right", value: (r) => r.quantity },
    { header: "Unit", width: 1, excelWidth: 9, value: (r) => r.unit },
  ];
  if (movementType === "in") {
    columns.push({ header: "Source", width: 1.9, excelWidth: 18, value: (r) => r.source || "" });
  }
  if (correctedCount > 0) {
    columns.push({ header: "Correction", width: 3.4, excelWidth: 45, muted: true, value: correctionNote });
  }

  const contextLines = [
    `Period: ${range.label}`,
    rows.length
      ? `${rows.length} movement${rows.length === 1 ? "" : "s"} · Totals by unit: ${formatTotals(totals)}`
      : "No movements in this period",
    correctedCount
      ? `${correctedCount} corrected entr${correctedCount === 1 ? "y shows its" : "ies show their"} corrected quantity; the original is in the Correction column`
      : "",
    `Generated ${formatDateTime(new Date())}`,
  ].filter(Boolean);

  return { ...config, range, rows, totals, columns, contextLines };
}

async function movementPdf(req, res, movementType) {
  const data = await loadMovementExport(movementType, req.query);
  const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
  const buffer = await pdfToBuffer(doc, () => {
    drawReportHeader(doc, { title: data.title, lines: data.contextLines });
    if (data.rows.length === 0) {
      doc.font("Helvetica").fontSize(11).text("No movements in this period.", { align: "center" });
    } else {
      drawTable(doc, { columns: data.columns, rows: data.rows });
    }
    addPageFooters(doc, `${data.title} · ${data.range.label}`);
  });
  sendFile(res, buffer, `${data.file}_${data.range.slug}.pdf`);
}

async function movementExcel(req, res, movementType) {
  const data = await loadMovementExport(movementType, req.query);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(data.sheet);
  const lastCol = data.columns.length;

  sheet.addRow([data.title]).font = { bold: true, size: 14 };
  data.contextLines.forEach((line) => sheet.addRow([line]).font = { color: { argb: "FF596460" } });
  sheet.addRow([]);

  const headerRow = sheet.addRow(data.columns.map((c) => c.header));
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  });
  const headerRowNumber = headerRow.number;

  data.rows.forEach((row) => {
    sheet.addRow(data.columns.map((c) => (c.excel ? c.excel(row) : c.value(row))));
  });

  data.columns.forEach((c, i) => {
    const column = sheet.getColumn(i + 1);
    column.width = c.excelWidth;
    if (c.numFmt) column.numFmt = c.numFmt;
    if (c.align) column.alignment = { horizontal: c.align };
  });

  if (data.rows.length) {
    sheet.addRow([]);
    data.totals.forEach((t) => {
      const row = sheet.addRow(["Total", "", t.quantity, t.unit]);
      row.font = { bold: true };
    });
    sheet.autoFilter = {
      from: { row: headerRowNumber, column: 1 },
      to: { row: headerRowNumber + data.rows.length, column: lastCol },
    };
  }
  sheet.views = [{ state: "frozen", ySplit: headerRowNumber }];

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  sendFile(res, buffer, `${data.file}_${data.range.slug}.xlsx`);
}

exports.exportStockInPDF = exportHandler("Stock in PDF export", (req, res) => movementPdf(req, res, "in"));
exports.exportStockOutPDF = exportHandler("Stock out PDF export", (req, res) => movementPdf(req, res, "out"));
exports.exportStockInExcel = exportHandler("Stock in Excel export", (req, res) => movementExcel(req, res, "in"));
exports.exportStockOutExcel = exportHandler("Stock out Excel export", (req, res) => movementExcel(req, res, "out"));

// ================= CURRENT STOCK (PDF / EXCEL) =================

const STATUS_TEXT = { out: "Out of stock", low: "Low", ok: "OK" };

const conflictText = (row) => {
  if (!row.unitConflicts.length) return "";
  const count = row.unitConflicts.reduce((sum, c) => sum + c.count, 0);
  const detail = row.unitConflicts.map((c) => `${c.quantity} ${c.unit} (stock ${c.direction})`).join(", ");
  return `${count} movement(s) in other units: ${detail}`;
};

const CURRENT_STOCK_COLUMNS = [
  { header: "Product", width: 3, value: (r) => r.product + (r.isActive ? "" : " (archived)") },
  { header: "Barcode", width: 1.8, value: (r) => r.barcode || "", onlyIfAny: (rows) => rows.some((r) => r.barcode) },
  { header: "Unit", width: 1, value: (r) => r.unit },
  { header: "Available", width: 1.2, align: "right", value: (r) => r.quantity },
  { header: "Min Stock", width: 1.4, align: "right", value: (r) => `${r.minStock}${r.minStockIsDefault ? " (default)" : ""}` },
  { header: "Status", width: 1.3, value: (r) => STATUS_TEXT[r.status] || r.status },
  { header: "Unit conflict", width: 3, value: (r) => conflictText(r) || "No" },
];

const currentStockFilename = (report, ext) =>
  `current-stock${report.includeArchived ? "-with-archived" : ""}_${isoToday()}.${ext}`;

const currentStockLines = (report) => {
  const { summary } = report;
  return [
    `As of ${formatDateTime(report.generatedAt)}${report.includeArchived ? " · includes archived products" : ""}`,
    `${summary.products} products · ${summary.out} out of stock · ${summary.low} low · ${summary.ok} OK` +
      (summary.withUnitConflicts ? ` · ${summary.withUnitConflicts} with unit conflicts` : ""),
    "Quantities are in each product's own unit, with corrections applied",
  ];
};

exports.exportCurrentStockExcel = exportHandler("Current stock Excel export", async (req, res) => {
  const report = await buildCurrentStockReport({ includeArchived: req.query.includeArchived === "true" });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Current Stock");
  sheet.addRow(["Current Stock Report"]).font = { bold: true, size: 14 };
  currentStockLines(report).forEach((line) => sheet.addRow([line]).font = { color: { argb: "FF596460" } });
  sheet.addRow([]);

  const headers = ["Product", "Barcode", "Unit", "Available", "Min Stock", "Min Stock Source", "Status", "Archived", "Unit Conflict"];
  const widths = [32, 18, 10, 12, 12, 18, 14, 10, 50];
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  });
  widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

  report.rows.forEach((row) => {
    const added = sheet.addRow([
      row.product,
      row.barcode || "",
      row.unit,
      row.quantity,
      row.minStock,
      row.minStockIsDefault ? "default" : "set",
      STATUS_TEXT[row.status] || row.status,
      row.isActive ? "No" : "Yes",
      conflictText(row) || "No",
    ]);
    // Keep barcodes as text so Excel does not drop leading zeros.
    added.getCell(2).numFmt = "@";
  });
  if (report.rows.length) {
    sheet.autoFilter = {
      from: { row: headerRow.number, column: 1 },
      to: { row: headerRow.number + report.rows.length, column: headers.length },
    };
  }
  sheet.views = [{ state: "frozen", ySplit: headerRow.number }];

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  sendFile(res, buffer, currentStockFilename(report, "xlsx"));
});

exports.exportCurrentStockPDF = exportHandler("Current stock PDF export", async (req, res) => {
  const report = await buildCurrentStockReport({ includeArchived: req.query.includeArchived === "true" });
  const doc = new PDFDocument({ margin: 40, size: "A4", layout: "landscape", bufferPages: true });
  const buffer = await pdfToBuffer(doc, () => {
    drawReportHeader(doc, { title: "Current Stock Report", lines: currentStockLines(report) });
    if (report.rows.length === 0) {
      doc.font("Helvetica").fontSize(11).text("No products.", { align: "center" });
    } else {
      // The Barcode column is shown only when at least one product has one.
      const columns = CURRENT_STOCK_COLUMNS.filter((c) => !c.onlyIfAny || c.onlyIfAny(report.rows));
      drawTable(doc, { columns, rows: report.rows });
    }
    addPageFooters(doc, `Current Stock Report · ${formatDate(report.generatedAt)}`);
  });
  sendFile(res, buffer, currentStockFilename(report, "pdf"));
});

// The paginated GET /api/export/stock-out endpoint was removed in Phase 3:
// it was never used by the frontend, filtered on createdAt instead of the
// movement date, ignored corrections and requested a non-existent "sku"
// field. Use GET /api/reports/stock-out?from=&to= for JSON data instead.
