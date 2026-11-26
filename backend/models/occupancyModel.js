const mongoose = require("mongoose");

// One document per business day (hotel time zone), keyed by the calendar
// date string "YYYY-MM-DD". Counts are optional: null/absent means "not
// known" and is never treated as 0 in calculations.
//
// source "dashboard_sync": written by POST /api/occupancy/sync
// source "manual":         entered/edited in the warehouse UI
// manualOverride: true -> syncs leave this day alone unless force=true.
const count = { type: Number, min: 0, default: null };
const apartmentList = { type: [String], default: [] };

// Apartment numbers behind the daily counts (from the dashboard). Older
// records have no breakdown; reads fall back to empty lists
// (utils/occupancyMeta.js normalizeMeta).
const breakdownSchema = new mongoose.Schema(
  {
    occupiedApartmentNumbers: apartmentList,
    checkInApartmentNumbers: apartmentList,
    checkOutApartmentNumbers: apartmentList,
    servicedApartmentNumbers: apartmentList,
    housekeepingApartmentNumbers: apartmentList,
    laundryApartmentNumbers: apartmentList,
    waterApartmentNumbers: apartmentList,
    pausedServiceApartments: apartmentList,
  },
  { _id: false }
);

const occupancySchema = new mongoose.Schema(
  {
    date: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },

    // Occupancy
    totalApartments: count,
    occupiedApartments: count,
    vacantApartments: count,
    checkIns: count,
    checkOuts: count,

    // Housekeeping / service
    servicedApartments: count,
    housekeepingCount: count,
    laundryCount: count,
    waterCount: count,

    // Day metadata (dashboard sync). Defaults keep older records valid.
    isSunday: { type: Boolean, default: false },
    isHoliday: { type: Boolean, default: false },
    holidayName: { type: String, trim: true, maxlength: 120, default: null },
    noScheduledCleaning: { type: Boolean, default: false },
    noServiceReason: { type: String, trim: true, maxlength: 300, default: null },
    pausedServiceApartments: { type: Number, min: 0, default: 0 },
    breakdown: { type: breakdownSchema, default: () => ({}) },

    note: { type: String, trim: true, maxlength: 500, default: "" },

    source: { type: String, enum: ["manual", "dashboard_sync"], required: true },
    manualOverride: { type: Boolean, default: false },
    syncedAt: { type: Date, default: null }, // last time a sync touched this day
    sourceUpdatedAt: { type: Date, default: null }, // dashboard's own updatedAt (stale-write guard)
    manualEditedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Exactly one record per day: upserts can never create duplicates.
occupancySchema.index({ date: 1 }, { unique: true, name: "date_unique" });

module.exports = mongoose.model("Occupancy", occupancySchema);
