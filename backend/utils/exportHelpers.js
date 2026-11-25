// Shared helpers for report exports: date ranges, date formatting, totals,
// filenames and buffered file responses.
//
// All calendar logic uses the SERVER's local time zone, the same as the
// daily/weekly report boundaries, so an export and the on-screen report for
// the same day always contain the same movements.

class ExportError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const pad = (n) => String(n).padStart(2, "0");

// "YYYY-MM-DD" -> { y, m, d }, "" / undefined -> null, anything else throws.
function parseDateInput(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (match) {
    const [y, m, d] = match.slice(1).map(Number);
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d) {
      return { y, m, d };
    }
  }
  throw new ExportError(400, `Invalid ${label} date "${value}". Use YYYY-MM-DD.`);
}

const startOfDay = ({ y, m, d }) => new Date(y, m - 1, d, 0, 0, 0, 0);
const endOfDay = ({ y, m, d }) => new Date(y, m - 1, d, 23, 59, 59, 999);
const partsOf = (date) => ({ y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() });
const isoDay = ({ y, m, d }) => `${y}-${pad(m)}-${pad(d)}`;
const gbDay = ({ y, m, d }) => `${pad(d)}/${pad(m)}/${y}`;

const EARLIEST = new Date(0);
const LATEST = new Date(8640000000000000);

// Resolves ?from=&to= into an inclusive [start, end] range (end of day).
//   both      -> from 00:00 to to 23:59:59.999
//   from only -> from .. end of today
//   to only   -> everything up to the end of `to`
//   neither   -> all dates
// Returns labels for titles and a slug for filenames (never "undefined").
function resolveExportRange(query = {}) {
  const from = parseDateInput(query.from, "from");
  const to = parseDateInput(query.to, "to");
  const today = partsOf(new Date());

  if (from && to && startOfDay(from) > startOfDay(to)) {
    throw new ExportError(400, "The from date must be on or before the to date.");
  }

  if (!from && !to) {
    return { start: EARLIEST, end: LATEST, label: "All dates", slug: "all-dates", allDates: true };
  }
  if (from && !to) {
    return {
      start: startOfDay(from),
      end: endOfDay(today),
      label: `${gbDay(from)} – ${gbDay(today)}`,
      slug: `${isoDay(from)}_to_${isoDay(today)}`,
    };
  }
  if (!from && to) {
    return { start: EARLIEST, end: endOfDay(to), label: `Up to ${gbDay(to)}`, slug: `until_${isoDay(to)}` };
  }
  const sameDay = isoDay(from) === isoDay(to);
  return {
    start: startOfDay(from),
    end: endOfDay(to),
    label: sameDay ? gbDay(from) : `${gbDay(from)} – ${gbDay(to)}`,
    slug: sameDay ? isoDay(from) : `${isoDay(from)}_to_${isoDay(to)}`,
  };
}

// Strict local-day range for the JSON range endpoints (both dates required).
function resolveRequiredRange(query = {}) {
  const from = parseDateInput(query.from, "from");
  const to = parseDateInput(query.to, "to");
  if (!from || !to) throw new ExportError(400, "from and to dates are required (YYYY-MM-DD).");
  return resolveExportRange(query);
}

// dd/mm/yyyy like the UI (en-GB), independent of the server's ICU/locale.
const formatDate = (date) => (date ? gbDay(partsOf(new Date(date))) : "");
const formatDateTime = (date) => {
  const d = new Date(date);
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const isoToday = () => isoDay(partsOf(new Date()));

// ExcelJS converts Date cells using UTC; build the cell from the local
// calendar day so it never shifts to the previous/next day.
const excelDate = (date) => {
  const { y, m, d } = partsOf(new Date(date));
  return new Date(Date.UTC(y, m - 1, d));
};

// [{unit, quantity}] in first-seen order; quantities in different units are
// never added together.
function totalsByUnit(rows) {
  const totals = new Map();
  rows.forEach((row) => {
    const unit = row.unit || "pcs";
    totals.set(unit, (totals.get(unit) || 0) + (Number(row.quantity) || 0));
  });
  return [...totals.entries()].map(([unit, quantity]) => ({ unit, quantity }));
}
const formatTotals = (totals) =>
  totals.length ? totals.map((t) => `${t.quantity} ${t.unit}`).join(" · ") : "0";

// Renders a pdfkit document fully in memory. Nothing is sent to the client
// until rendering succeeded, so a failure can still return a JSON error.
function pdfToBuffer(doc, render) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      render(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

const CONTENT_TYPES = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function sendFile(res, buffer, filename) {
  const ext = filename.split(".").pop();
  res.setHeader("Content-Type", CONTENT_TYPES[ext] || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", buffer.length);
  res.end(buffer);
}

// Wraps an export handler: validation errors -> 4xx JSON, anything else ->
// 500 JSON. Because files are buffered, headers are never sent twice.
const exportHandler = (label, handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    if (res.headersSent) {
      console.error(`${label} failed after headers were sent:`, err);
      return res.end();
    }
    if (err instanceof ExportError) return res.status(err.status).json({ message: err.message });
    console.error(`${label} failed:`, err);
    res.status(500).json({ message: `${label} failed` });
  }
};

module.exports = {
  ExportError,
  resolveExportRange,
  resolveRequiredRange,
  formatDate,
  formatDateTime,
  isoToday,
  excelDate,
  totalsByUnit,
  formatTotals,
  pdfToBuffer,
  sendFile,
  exportHandler,
};
