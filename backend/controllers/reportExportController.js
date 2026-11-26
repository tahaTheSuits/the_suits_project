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
const { buildOccupancyConsumptionReport, metricText, METRICS } = require("../utils/occupancyReport");
const { dayTypeText, BREAKDOWN_KEYS } = require("../utils/occupancyMeta");
const { gbDay } = require("../utils/businessDay");

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

const signedQty = (n) => (n > 0 ? `+${n}` : String(n));
// Stored stock vs ledger (see utils/reconciliation.js).
const ledgerCheckText = (row) => {
  const r = row.reconciliation;
  if (!r || r.balanced) return "Balanced";
  if (r.current === null) return "Mismatch (no stored value)";
  return `Mismatch ${signedQty(r.difference)} (stored ${r.current})`;
};

const CURRENT_STOCK_COLUMNS = [
  { header: "Product", width: 3, value: (r) => r.product + (r.isActive ? "" : " (archived)") },
  { header: "Barcode", width: 1.8, value: (r) => r.barcode || "", onlyIfAny: (rows) => rows.some((r) => r.barcode) },
  { header: "Unit", width: 1, value: (r) => r.unit },
  { header: "Available", width: 1.2, align: "right", value: (r) => r.quantity },
  { header: "Min Stock", width: 1.4, align: "right", value: (r) => `${r.minStock}${r.minStockIsDefault ? " (default)" : ""}` },
  { header: "Status", width: 1.3, value: (r) => STATUS_TEXT[r.status] || r.status },
  { header: "Ledger check", width: 2, value: ledgerCheckText },
  { header: "Unit conflict", width: 2.6, value: (r) => conflictText(r) || "No" },
];

const currentStockFilename = (report, ext) =>
  `current-stock${report.includeArchived ? "-with-archived" : ""}_${isoToday()}.${ext}`;

const currentStockLines = (report) => {
  const { summary } = report;
  return [
    `As of ${formatDateTime(report.generatedAt)}${report.includeArchived ? " · includes archived products" : ""}`,
    `${summary.products} products · ${summary.out} out of stock · ${summary.low} low · ${summary.ok} OK` +
      (summary.withUnitConflicts ? ` · ${summary.withUnitConflicts} with unit conflicts` : "") +
      (summary.ledgerMismatches ? ` · ${summary.ledgerMismatches} ledger mismatch(es)` : " · all balanced with the ledger"),
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

  const headers = ["Product", "Barcode", "Unit", "Available", "Min Stock", "Min Stock Source", "Status", "Archived", "Unit Conflict", "Ledger Check", "Stored Stock", "Difference"];
  const widths = [32, 18, 10, 12, 12, 18, 14, 10, 50, 26, 13, 12];
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
      ledgerCheckText(row),
      row.reconciliation?.current ?? null,
      row.reconciliation?.difference ?? null,
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

// ================= OCCUPANCY-BASED CONSUMPTION (PDF / EXCEL) =================
// GET /api/export/occupancy-consumption/{pdf|excel}?from=YYYY-MM-DD&to=YYYY-MM-DD
// Same data as GET /api/reports/occupancy-consumption.

const dash = (v) => (v === null || v === undefined ? "–" : v);
const pct = (rate) => (rate === null ? "N/A" : `${Math.round(rate * 1000) / 10}%`);
const sourceText = (day) =>
  !day.hasRecord ? "No record" : `${day.source === "manual" ? "Manual" : "Sync"}${day.manualOverride ? " (override)" : ""}`;
const unitTotals = (list) => (list.length ? list.map((t) => `${t.quantity} ${t.unit}`).join(" · ") : "–");

const ruleText = (row) => {
  const r = row.alertRule;
  if (!r) return "";
  if (r.basis === "none") return "alerts off";
  const limit = r.normalMaxThreshold !== null ? `, max ${r.normalMaxThreshold}` : "";
  return `alerts ${r.basisLabel}${limit}${r.inferred ? " (auto)" : ""}`;
};

const productNotes = (row) =>
  [
    ruleText(row),
    row.archived ? "archived product" : "",
    row.outWithoutOccupancy > 0 ? `${row.outWithoutOccupancy} ${row.unit} on days without occupancy data` : "",
    row.unitConflicts ? `${row.unitConflicts} movement(s) recorded in another unit` : "",
  ]
    .filter(Boolean)
    .join("; ");

const changeText = (c) => (c ? c.label : "");

// "Previous period 01/10/2026 – 31/10/2026: pcs 120 -> 96 (-20%) · gallon ..."
const comparisonLines = (report) => {
  const c = report.comparison;
  if (!c) return [];
  const totals = c.byUnit.length
    ? c.byUnit.map((t) => `${t.unit} ${t.previous} → ${t.current} (${t.change.label})`).join(" · ")
    : "no stock out in either period";
  return [
    `Compared with the previous ${c.kind === "months" ? `${c.months} calendar month(s)` : `${c.days} days`} (${c.label}): ${totals}`,
    `${c.increased} product(s) up, ${c.decreased} down, ${c.unchanged} unchanged · increases of ${c.significantIncreasePct}% or more are significant`,
  ];
};

const occupancyLines = (report) => {
  const s = report.summary;
  return [
    ...comparisonLines(report),
    `Period: ${report.label} · business days in ${report.timeZone}`,
    `Occupancy data for ${s.daysWithOccupancy} of ${s.totalDays} days · service data for ${s.daysWithServicedApartments} · housekeeping data for ${s.daysWithHousekeeping}`,
    `Occupied apartment-nights: ${dash(s.occupiedApartmentNights)} · serviced apartments: ${dash(s.servicedApartments)} · housekeeping tasks: ${dash(s.housekeepingTasks)} · average occupancy: ${pct(s.averageOccupancyRate)}`,
    ...(s.anomalyDays
      ? [`Consumption alerts on ${s.anomalyDays} day(s): per product basis (housekeeping / laundry / water room, or daily total); above the product's normal maximum, or over ${s.anomalyFactor}× its period average with more than ${s.anomalyMinQuantity} units, or used on a day without that service`]
      : []),
    ...(s.daysNoScheduledCleaning || s.daysHoliday || s.daysSunday
      ? [`Sundays: ${s.daysSunday || 0} · holidays: ${s.daysHoliday || 0} · days without scheduled cleaning: ${s.daysNoScheduledCleaning || 0}`]
      : []),
    "Averages use only days that have the relevant data; quantities are in each product's own unit (corrections applied)",
    `Generated ${formatDateTime(report.generatedAt)}`,
  ];
};

const CONSUMPTION_COLUMNS = [
  { header: "Product", width: 2.6, value: (r) => r.product },
  { header: "Unit", width: 0.9, value: (r) => r.unit },
  { header: "Total out", width: 1.1, align: "right", value: (r) => r.totalOut },
  ...METRICS.map((m) => ({
    header: `Per ${m.label.replace(/^per /, "")}`,
    width: 2.1,
    value: (r) => metricText(r[m.key], r.unit),
  })),
  { header: "Notes", width: 2.6, muted: true, value: productNotes },
];

const DAY_COLUMNS = [
  { header: "Date", width: 1.2, value: (d) => gbDay(d.date) },
  {
    header: "Day",
    width: 1.6,
    muted: true,
    value: (d) => [dayTypeText(d), d.anomaly?.flagged ? "CONSUMPTION ALERT" : ""].filter(Boolean).join(" · ") || "–",
  },
  {
    header: "Occupied / total",
    width: 1.4,
    value: (d) =>
      d.occupiedApartments === null && d.totalApartments === null
        ? "–"
        : `${dash(d.occupiedApartments)} / ${dash(d.totalApartments)}`,
  },
  { header: "Vacant", width: 0.8, align: "right", value: (d) => dash(d.vacantApartments) },
  { header: "Check-ins", width: 0.9, align: "right", value: (d) => dash(d.checkIns) },
  { header: "Check-outs", width: 0.9, align: "right", value: (d) => dash(d.checkOuts) },
  { header: "Serviced", width: 0.9, align: "right", value: (d) => dash(d.servicedApartments) },
  { header: "Housekeeping", width: 1.1, align: "right", value: (d) => dash(d.housekeepingCount) },
  { header: "Laundry", width: 0.8, align: "right", value: (d) => dash(d.laundryCount) },
  { header: "Water", width: 0.8, align: "right", value: (d) => dash(d.waterCount) },
  { header: "Source", width: 1.1, value: sourceText },
  { header: "Stock out", width: 1.9, value: (d) => unitTotals(d.stockOutByUnit) },
];

const TREND_TEXT = { down: "Lower", same: "Unchanged", up: "Higher", high: "Significantly higher", new: "New this period" };
const TREND_COLUMNS = [
  { header: "Product", width: 3, value: (r) => r.product + (r.archived ? " (archived)" : "") },
  { header: "Unit", width: 0.9, value: (r) => r.unit },
  { header: "Previous period", width: 1.4, align: "right", value: (r) => r.previousOut },
  { header: "This period", width: 1.4, align: "right", value: (r) => r.totalOut },
  { header: "Change", width: 1.2, align: "right", value: (r) => changeText(r.change) },
  { header: "Trend", width: 2, muted: true, value: (r) => TREND_TEXT[r.change.trend] || "" },
];
// Biggest increases first, then the rest by name.
const TREND_ORDER = { high: 0, new: 1, up: 2, same: 3, down: 4 };
const trendRows = (report) =>
  [...report.products].sort(
    (a, b) =>
      TREND_ORDER[a.change.trend] - TREND_ORDER[b.change.trend] ||
      (b.change.pct ?? 0) - (a.change.pct ?? 0) ||
      a.product.localeCompare(b.product, "en", { sensitivity: "base" }),
  );

exports.exportOccupancyConsumptionPDF = exportHandler("Occupancy consumption PDF export", async (req, res) => {
  const report = await buildOccupancyConsumptionReport(req.query);
  const title = "Consumption vs Occupancy";
  const doc = new PDFDocument({ margin: 36, size: "A4", layout: "landscape", bufferPages: true });
  const buffer = await pdfToBuffer(doc, () => {
    drawReportHeader(doc, { title, lines: occupancyLines(report) });

    doc.font("Helvetica-Bold").fontSize(12).text("Consumption by product");
    doc.moveDown(0.3);
    if (report.products.length === 0) {
      doc.font("Helvetica").fontSize(10).text("No stock out in this period.");
      doc.moveDown();
    } else {
      drawTable(doc, { columns: CONSUMPTION_COLUMNS, rows: report.products, fontSize: 8.5 });
    }

    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#1f2926").text("Daily occupancy and service", doc.page.margins.left);
    doc.moveDown(0.3);
    drawTable(doc, { columns: DAY_COLUMNS, rows: report.days, fontSize: 8.5 });

    // Period-over-period trend per product.
    doc.moveDown(0.5);
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor("#1f2926")
      .text(`Period over period (vs ${report.comparison.label})`, doc.page.margins.left);
    doc.moveDown(0.3);
    if (report.products.length === 0) {
      doc.font("Helvetica").fontSize(10).text("No stock out in either period.");
    } else {
      drawTable(doc, { columns: TREND_COLUMNS, rows: trendRows(report), fontSize: 8.5 });
    }

    addPageFooters(doc, `${title} · ${report.label}`);
  });
  sendFile(res, buffer, `occupancy-consumption_${report.slug}.pdf`);
});

function addStyledHeader(sheet, headers, widths) {
  const row = sheet.addRow(headers);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  });
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
  return row;
}

exports.exportOccupancyConsumptionExcel = exportHandler("Occupancy consumption Excel export", async (req, res) => {
  const report = await buildOccupancyConsumptionReport(req.query);
  const workbook = new ExcelJS.Workbook();

  // Sheet 1: per product. Metric cells are numbers when available, "N/A (...)" otherwise.
  const sheet = workbook.addWorksheet("Consumption");
  sheet.addRow(["Consumption vs Occupancy"]).font = { bold: true, size: 14 };
  occupancyLines(report).forEach((line) => {
    sheet.addRow([line]).font = { color: { argb: "FF596460" } };
  });
  Object.values(report.formulas).forEach((f) => {
    sheet.addRow([f]).font = { italic: true, color: { argb: "FF596460" } };
  });
  sheet.addRow([]);
  const metricHeaders = METRICS.flatMap((m) => [`Per ${m.label.replace(/^per /, "")}`, `Days with data (${m.label})`]);
  const header = addStyledHeader(
    sheet,
    ["Product", "Unit", "Total out", "Movements", ...metricHeaders, "Out on days without occupancy", "Unit conflicts", "Archived", "Notes", "Alert basis", "Normal max", "Period average (alert basis)", "Previous Period Out", "Change (%)"],
    [30, 9, 11, 11, ...METRICS.flatMap(() => [24, 14]), 18, 12, 10, 40, 26, 12, 16, 18, 12],
  );
  report.products.forEach((r) => {
    sheet.addRow([
      r.product,
      r.unit,
      r.totalOut,
      r.movements,
      ...METRICS.flatMap((m) => [
        r[m.key].value === null ? `N/A (${r[m.key].note})` : r[m.key].value,
        `${r[m.key].daysWithData} / ${r[m.key].totalDays}`,
      ]),
      r.outWithoutOccupancy,
      r.unitConflicts,
      r.archived ? "Yes" : "No",
      productNotes(r),
      r.alertRule.basis === "none" ? "none (no alerts)" : `${r.alertRule.basis} (${r.alertRule.basisLabel})${r.alertRule.inferred ? " auto" : ""}`,
      r.alertRule.normalMaxThreshold,
      r.alertRule.average,
      r.previousOut,
      // Number (e.g. -20) when there is a baseline, "New" when there was none.
      r.change.pct === null ? r.change.label : r.change.pct,
    ]);
  });
  if (report.products.length === 0) sheet.addRow(["No stock out in this period."]);
  sheet.views = [{ state: "frozen", ySplit: header.number }];

  // Sheet 2: per day. Unknown values stay empty (never 0).
  const days = workbook.addWorksheet("Daily occupancy");
  const dayHeader = addStyledHeader(
    days,
    [
      "Date", "Total apartments", "Occupied", "Vacant", "Check-ins", "Check-outs", "Serviced", "Housekeeping", "Laundry", "Water", "Source", "Note", "Stock out (by unit)",
      "Sunday", "Holiday", "Holiday name", "No scheduled cleaning", "No-service reason", "Paused service apartments",
      "Occupied apts", "Check-in apts", "Check-out apts", "Serviced apts", "Housekeeping apts", "Laundry apts", "Water apts", "Paused apts",
      "Consumption alert",
    ],
    [12, 16, 10, 9, 10, 11, 10, 13, 9, 8, 16, 30, 30, 9, 9, 22, 12, 30, 12, 28, 22, 22, 28, 22, 22, 22, 22, 60],
  );
  report.days.forEach((d) => {
    const [y, m, dd] = d.date.split("-").map(Number);
    const row = days.addRow([
      new Date(Date.UTC(y, m - 1, dd)),
      d.totalApartments,
      d.occupiedApartments,
      d.vacantApartments,
      d.checkIns,
      d.checkOuts,
      d.servicedApartments,
      d.housekeepingCount,
      d.laundryCount,
      d.waterCount,
      sourceText(d),
      d.note,
      unitTotals(d.stockOutByUnit),
      d.isSunday ? "Yes" : "No",
      d.isHoliday ? "Yes" : "No",
      d.holidayName || "",
      d.noScheduledCleaning ? "Yes" : "No",
      d.noServiceReason || "",
      d.pausedServiceApartments,
      ...BREAKDOWN_KEYS.map((k) => d.breakdown[k].join(", ")),
      d.anomaly?.flagged ? d.anomaly.reasons.map((r) => r.message).join(" ") : "",
    ]);
    row.getCell(1).numFmt = "dd/mm/yyyy";
  });
  days.views = [{ state: "frozen", ySplit: dayHeader.number }];

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  sendFile(res, buffer, `occupancy-consumption_${report.slug}.xlsx`);
});
