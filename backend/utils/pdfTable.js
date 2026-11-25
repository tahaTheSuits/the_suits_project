// Minimal table renderer for pdfkit: fixed column widths, wrapped cells,
// header row repeated on every page, zebra striping. Written for the
// Current Stock export; Phase 3 can reuse it for the other exports.

const HEADER_FILL = "#5f756d";
const STRIPE_FILL = "#f1f3ec";
const BORDER = "#d2d8cf";
const PADDING = 4;

function drawTable(doc, { columns, rows, fontSize = 9 }) {
  const left = doc.page.margins.left;
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const totalWeight = columns.reduce((sum, c) => sum + (c.width || 1), 0);
  const widths = columns.map((c) => ((c.width || 1) / totalWeight) * usable);
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  const rowHeight = (cells, font) => {
    doc.font(font).fontSize(fontSize);
    return (
      Math.max(
        ...cells.map((text, i) => doc.heightOfString(text, { width: widths[i] - PADDING * 2 })),
      ) +
      PADDING * 2
    );
  };

  const drawRow = (cells, y, { font, fill, color }) => {
    const height = rowHeight(cells, font);
    if (fill) doc.rect(left, y, usable, height).fill(fill);
    doc.font(font).fontSize(fontSize).fillColor(color);
    let x = left;
    cells.forEach((text, i) => {
      doc.text(text, x + PADDING, y + PADDING, {
        width: widths[i] - PADDING * 2,
        align: columns[i].align || "left",
      });
      x += widths[i];
    });
    doc.moveTo(left, y + height).lineTo(left + usable, y + height).strokeColor(BORDER).lineWidth(0.5).stroke();
    return height;
  };

  const headerCells = columns.map((c) => c.header);
  const drawHeader = (y) => drawRow(headerCells, y, { font: "Helvetica-Bold", fill: HEADER_FILL, color: "#ffffff" });

  let y = doc.y;
  y += drawHeader(y);

  rows.forEach((row, index) => {
    const cells = columns.map((c) => {
      const value = typeof c.value === "function" ? c.value(row) : row[c.key];
      return value === undefined || value === null || value === "" ? "-" : String(value);
    });
    if (y + rowHeight(cells, "Helvetica") > bottom()) {
      doc.addPage();
      y = doc.page.margins.top;
      y += drawHeader(y);
    }
    y += drawRow(cells, y, {
      font: "Helvetica",
      fill: index % 2 === 1 ? STRIPE_FILL : null,
      color: "#1f2926",
    });
  });

  doc.x = left;
  doc.y = y + 8;
  doc.fillColor("#000000");
}

module.exports = { drawTable };
