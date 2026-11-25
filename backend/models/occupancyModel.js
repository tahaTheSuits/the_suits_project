const mongoose = require("mongoose");

// One document per business day (hotel time zone), keyed by the calendar
// date string "YYYY-MM-DD". Counts are optional: null/absent means "not
// known" and is never treated as 0 in calculations.
//
// source "dashboard_sync": written by POST /api/occupancy/sync
// source "manual":         entered/edited in the warehouse UI
// manualOverride: true -> syncs leave this day alone unless force=true.
const count = { type: Number, min: 0, default: null };

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
