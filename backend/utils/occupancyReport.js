// Occupancy-based consumption report.
//
// Stock out per product and business day uses the corrected (effective)
// quantities from Phase 2, always in the product's own unit; quantities of
// different products/units are never added together.
//
// Ratios use only the days that have the relevant data ("matched days"), so a
// day without occupancy records never inflates or deflates the average:
//
//   per occupied apartment = Σ stock out on days with occupiedApartments
//                            ÷ Σ occupiedApartments on those days
//   per serviced apartment = Σ stock out on days with servicedApartments
//                            ÷ Σ servicedApartments on those days
//   per housekeeping task  = Σ stock out on days with housekeepingCount
//                            ÷ Σ housekeepingCount on those days
//
// No matching days -> value null ("No … data"). Matching days whose
// denominator sums to 0 -> value null ("No occupied apartments" etc.).
// Never NaN, Infinity or an invented 0.
const Product = require("../models/productModel");
const StockOut = require("../models/stockOutModel");
const Occupancy = require("../models/occupancyModel");
const { DEFAULT_UNIT, normalizeUnit } = require("./units");
const { latestCorrectionLookup, EFFECTIVE_QUANTITY, IS_CORRECTED, productUnitOf } = require("./stock");
const { businessTimeZone, paddedUtcWindow, resolveDayRange } = require("./businessDay");
const { normalizeMeta } = require("./occupancyMeta");

const OCCUPANCY_FIELDS = [
  "totalApartments",
  "occupiedApartments",
  "vacantApartments",
  "checkIns",
  "checkOuts",
  "servicedApartments",
  "housekeepingCount",
  "laundryCount",
  "waterCount",
];

const METRICS = [
  {
    key: "perOccupiedApartment",
    field: "occupiedApartments",
    label: "per occupied apartment",
    noData: "No occupancy data",
    zero: "No occupied apartments",
  },
  {
    key: "perServicedApartment",
    field: "servicedApartments",
    label: "per serviced apartment",
    noData: "No service data",
    zero: "No serviced apartments",
  },
  {
    key: "perHousekeepingTask",
    field: "housekeepingCount",
    label: "per housekeeping task",
    noData: "No housekeeping data",
    zero: "No housekeeping tasks",
  },
];

const FORMULAS = {
  perOccupiedApartment:
    "Σ stock out on days with occupancy data ÷ Σ occupied apartments on those days",
  perServicedApartment:
    "Σ stock out on days with service data ÷ Σ serviced apartments on those days",
  perHousekeepingTask:
    "Σ stock out on days with housekeeping data ÷ Σ housekeeping tasks on those days",
};

const round = (n, digits = 3) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

const known = (v) => typeof v === "number" && Number.isFinite(v);

function computeMetric(metric, dayQty, occupancyByDay, totalDays) {
  const matchedDays = [];
  let denominator = 0;
  occupancyByDay.forEach((record, day) => {
    if (known(record[metric.field])) {
      matchedDays.push(day);
      denominator += record[metric.field];
    }
  });
  const numerator = matchedDays.reduce((sum, day) => sum + (dayQty.get(day) || 0), 0);
  const base = {
    numerator: round(numerator),
    denominator,
    daysWithData: matchedDays.length,
    totalDays,
  };
  if (matchedDays.length === 0) return { ...base, value: null, status: "no_data", note: metric.noData };
  if (denominator === 0) return { ...base, value: null, status: "zero", note: metric.zero };
  return {
    ...base,
    value: round(numerator / denominator, 4),
    status: matchedDays.length < totalDays ? "partial" : "ok",
    note: matchedDays.length < totalDays ? `Based on ${matchedDays.length} of ${totalDays} days` : "",
  };
}

const sumKnown = (records, field) => {
  const values = records.map((r) => r[field]).filter(known);
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
};

async function buildOccupancyConsumptionReport(query = {}) {
  const range = resolveDayRange(query, { defaultDays: 7, maxDays: 366 });
  const timeZone = businessTimeZone();
  const window = paddedUtcWindow(range.from, range.to);

  const [rows, occupancyRecords] = await Promise.all([
    StockOut.aggregate([
      { $match: { date: { $gte: window.start, $lt: window.end } } },
      { $addFields: { businessDay: { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: timeZone } } } },
      { $match: { businessDay: { $gte: range.from, $lte: range.to } } },
      latestCorrectionLookup("out"),
      {
        $group: {
          _id: { product: "$product", day: "$businessDay", unit: "$unit", corrected: IS_CORRECTED },
          quantity: { $sum: EFFECTIVE_QUANTITY },
          movements: { $sum: { $cond: [{ $gt: [EFFECTIVE_QUANTITY, 0] }, 1, 0] } },
        },
      },
    ]),
    Occupancy.find({ date: { $gte: range.from, $lte: range.to } }).sort({ date: 1 }).lean(),
  ]);

  const productIds = [...new Set(rows.map((r) => String(r._id.product)))];
  const products = await Product.find({ _id: { $in: productIds } }).lean();
  const productById = new Map(products.map((p) => [String(p._id), p]));
  const occupancyByDay = new Map(occupancyRecords.map((r) => [r.date, r]));
  const totalDays = range.days.length;

  // Per product: quantity per day + unit-conflict count.
  const perProduct = new Map();
  rows.forEach((row) => {
    const id = String(row._id.product);
    const product = productById.get(id);
    const unit = product ? productUnitOf(product) : normalizeUnit(row._id.unit) || DEFAULT_UNIT;
    const entry = perProduct.get(id) || { product, unit, dayQty: new Map(), movements: 0, unitConflicts: 0 };
    entry.dayQty.set(row._id.day, (entry.dayQty.get(row._id.day) || 0) + row.quantity);
    entry.movements += row.movements;
    const movementUnit = normalizeUnit(row._id.unit) || DEFAULT_UNIT;
    if (!row._id.corrected && movementUnit !== unit) entry.unitConflicts += row.movements;
    perProduct.set(id, entry);
  });

  const productRows = [...perProduct.entries()].map(([id, entry]) => {
    const totalOut = [...entry.dayQty.values()].reduce((a, b) => a + b, 0);
    const metrics = Object.fromEntries(
      METRICS.map((m) => [m.key, computeMetric(m, entry.dayQty, occupancyByDay, totalDays)]),
    );
    const outWithoutOccupancy = [...entry.dayQty.entries()]
      .filter(([day]) => !known(occupancyByDay.get(day)?.occupiedApartments))
      .reduce((sum, [, qty]) => sum + qty, 0);
    return {
      productId: id,
      product: entry.product?.name || "Unknown product",
      archived: entry.product?.isActive === false,
      barcode: entry.product?.barcode || null,
      unit: entry.unit,
      totalOut: round(totalOut),
      movements: entry.movements,
      daysWithStockOut: [...entry.dayQty.values()].filter((q) => q > 0).length,
      outWithoutOccupancy: round(outWithoutOccupancy),
      unitConflicts: entry.unitConflicts,
      ...metrics,
    };
  });
  productRows.sort((a, b) => a.product.localeCompare(b.product, "en", { sensitivity: "base" }));

  // Per day: occupancy record (or nulls) + stock out totals by unit.
  const dayOut = new Map();
  perProduct.forEach((entry) => {
    entry.dayQty.forEach((qty, day) => {
      const byUnit = dayOut.get(day) || new Map();
      byUnit.set(entry.unit, (byUnit.get(entry.unit) || 0) + qty);
      dayOut.set(day, byUnit);
    });
  });
  const days = range.days.map((day) => {
    const record = occupancyByDay.get(day);
    const fields = Object.fromEntries(OCCUPANCY_FIELDS.map((f) => [f, record && known(record[f]) ? record[f] : null]));
    return {
      date: day,
      ...fields,
      // isSunday, isHoliday, holidayName, noScheduledCleaning, noServiceReason,
      // pausedServiceApartments, breakdown (defaults for older records).
      ...normalizeMeta(record),
      hasRecord: Boolean(record),
      hasOccupancy: known(fields.occupiedApartments),
      hasService: known(fields.servicedApartments) || known(fields.housekeepingCount),
      source: record?.source || null,
      manualOverride: Boolean(record?.manualOverride),
      note: record?.note || "",
      stockOutByUnit: [...(dayOut.get(day) || new Map()).entries()].map(([unit, quantity]) => ({
        unit,
        quantity: round(quantity),
      })),
    };
  });

  const recordsInRange = occupancyRecords;
  const occupancyRateDays = recordsInRange.filter((r) => known(r.totalApartments) && known(r.occupiedApartments));
  const totalForRate = occupancyRateDays.reduce((s, r) => s + r.totalApartments, 0);
  const occupiedForRate = occupancyRateDays.reduce((s, r) => s + r.occupiedApartments, 0);

  const summary = {
    totalDays,
    daysWithRecord: recordsInRange.length,
    daysWithOccupancy: days.filter((d) => d.hasOccupancy).length,
    daysWithServicedApartments: days.filter((d) => d.servicedApartments !== null).length,
    daysWithHousekeeping: days.filter((d) => d.housekeepingCount !== null).length,
    occupiedApartmentNights: sumKnown(recordsInRange, "occupiedApartments"),
    servicedApartments: sumKnown(recordsInRange, "servicedApartments"),
    housekeepingTasks: sumKnown(recordsInRange, "housekeepingCount"),
    laundry: sumKnown(recordsInRange, "laundryCount"),
    water: sumKnown(recordsInRange, "waterCount"),
    checkIns: sumKnown(recordsInRange, "checkIns"),
    checkOuts: sumKnown(recordsInRange, "checkOuts"),
    averageOccupancyRate: totalForRate > 0 ? round(occupiedForRate / totalForRate, 4) : null,
    productsWithStockOut: productRows.length,
    daysSunday: days.filter((d) => d.isSunday).length,
    daysHoliday: days.filter((d) => d.isHoliday).length,
    daysNoScheduledCleaning: days.filter((d) => d.noScheduledCleaning).length,
  };

  return {
    from: range.from,
    to: range.to,
    label: range.label,
    slug: range.slug,
    timeZone,
    generatedAt: new Date(),
    formulas: FORMULAS,
    summary,
    products: productRows,
    days,
  };
}

// "0.214 pcs" / "N/A (No occupancy data)" / "0.2 pcs (5 of 7 days)"
function metricText(metric, unit) {
  if (!metric || metric.value === null) return `N/A (${metric?.note || "No data"})`;
  return `${metric.value} ${unit}${metric.status === "partial" ? ` (${metric.daysWithData} of ${metric.totalDays} days)` : ""}`;
}

module.exports = { buildOccupancyConsumptionReport, metricText, METRICS, FORMULAS };
