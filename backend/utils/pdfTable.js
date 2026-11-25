// pdfkit layout helpers shared by every PDF export:
//   drawReportHeader  title + context lines (period, units, totals)
//   drawTable         fixed-weight columns, wrapped cells, header row repeated
//                     on every page, zebra striping
//   addPageFooters    "Title · Page X of Y" on every page
// Documents must be created with { bufferPages: true } for page footers.

const HEADER_FILL = "#5f756d";
const STRIPE_FILL = "#f1f3ec";
const BORDER = "#d2d8cf";
const TEXT = "#1f2926";
const MUTED = "#596460";
const PADDING = 4;

const cellText = (value) =>
  value === undefined || value === null || value === "" ? "" : String(value).replace(/\s+/g, " ").trim();

function drawReportHeader(doc, { title, lines = [] }) {
  doc.font("Helvetica-Bold").fontSize(18).fillColor(TEXT).text(title, { align: "center" });
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(10).fillColor(MUTED);
  lines.filter(Boolean).forEach((line) => doc.text(line, { align: "center" }));
  doc.fillColor(TEXT).moveDown(1);
}

function drawTable(doc, { columns, rows, fontSize = 9 }) {
  const left = doc.page.margins.left;
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const totalWeight = columns.reduce((sum, c) => sum + (c.width || 1), 0);
  const widths = columns.map((c) => ((c.width || 1) / totalWeight) * usable);
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  const rowHeight = (cells, font) => {
    doc.font(font).fontSize(fontSize);
    return (
      Math.max(...cells.map((text, i) => doc.heightOfString(text || " ", { width: widths[i] - PADDING * 2 }))) +
      PADDING * 2
    );
  };

  const drawRow = (cells, y, { font, fill, color, cellColors = [] }) => {
    const height = rowHeight(cells, font);
    if (fill) doc.rect(left, y, usable, height).fill(fill);
    doc.font(font).fontSize(fontSize);
    let x = left;
    cells.forEach((text, i) => {
      doc.fillColor(cellColors[i] || color).text(text, x + PADDING, y + PADDING, {
        width: widths[i] - PADDING * 2,
        align: columns[i].align || "left",
        lineBreak: true,
      });
      x += widths[i];
    });
    doc.moveTo(left, y + height).lineTo(left + usable, y + height).strokeColor(BORDER).lineWidth(0.5).stroke();
    return height;
  };

  const headerCells = columns.map((c) => c.header);
  const drawHeader = (y) => drawRow(headerCells, y, { font: "Helvetica-Bold", fill: HEADER_FILL, color: "#ffffff" });

  let y = doc.y;
  if (y + rowHeight(headerCells, "Helvetica-Bold") * 2 > bottom()) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  y += drawHeader(y);

  rows.forEach((row, index) => {
    const cells = columns.map((c) => cellText(typeof c.value === "function" ? c.value(row) : row[c.key]));
    const cellColors = columns.map((c) => (c.muted ? MUTED : null));
    if (y + rowHeight(cells, "Helvetica") > bottom()) {
      doc.addPage();
      y = doc.page.margins.top;
      y += drawHeader(y);
    }
    y += drawRow(cells, y, {
      font: "Helvetica",
      fill: index % 2 === 1 ? STRIPE_FILL : null,
      color: TEXT,
      cellColors,
    });
  });

  doc.x = left;
  doc.y = y + 8;
  doc.fillColor(TEXT);
}

function addPageFooters(doc, label) {
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i += 1) {
    doc.switchToPage(i);
    // Writing inside the bottom margin would otherwise trigger a new page.
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(MUTED)
      .text(`${label} · Page ${i - start + 1} of ${count}`, doc.page.margins.left, doc.page.height - 28, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: "center",
        lineBreak: false,
      });
    doc.page.margins.bottom = bottomMargin;
  }
  doc.fillColor(TEXT);
}

module.exports = { drawReportHeader, drawTable, addPageFooters };
