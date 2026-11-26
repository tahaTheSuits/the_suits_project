const mongoose = require("mongoose");

// Small key/value store for application settings (one document per key).
//   key "period_lock": value = { lockedThroughDate: "YYYY-MM-DD" | null }
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    value: { type: mongoose.Schema.Types.Mixed, default: {} },
    reason: { type: String, trim: true, maxlength: 500, default: "" },
  },
  { timestamps: true, minimize: false }
);

settingSchema.index({ key: 1 }, { unique: true, name: "key_unique" });

const Setting = mongoose.model("Setting", settingSchema);

// Append-only audit of setting changes (never updated or deleted).
//   action for period_lock: "set" (first lock), "moved_forward",
//   "moved_back", "cleared"
const settingAuditSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    action: { type: String, required: true },
    previousValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },
    reason: { type: String, trim: true, maxlength: 500, default: "" },
  },
  { timestamps: true }
);

settingAuditSchema.index({ key: 1, createdAt: -1 });

const SettingAudit = mongoose.model("SettingAudit", settingAuditSchema);

module.exports = { Setting, SettingAudit };
