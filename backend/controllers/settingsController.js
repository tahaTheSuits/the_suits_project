// Settings.
//   GET   /api/settings/period-lock   { lockedThroughDate, updatedAt, reason, history[] }
//   PATCH /api/settings/period-lock   { lockedThroughDate: "YYYY-MM-DD" | null, reason?,
//                                       expectedLockedThroughDate? }
// Every change is written to the settings audit trail.
const {
  getPeriodLock,
  updatePeriodLock,
  periodLockHistory,
  PeriodLockInputError,
} = require("../utils/periodLock");
const { todayKey, businessTimeZone } = require("../utils/businessDay");

exports.getPeriodLock = async (req, res) => {
  try {
    res.json({ ...(await getPeriodLock()), today: todayKey(), timeZone: businessTimeZone(), history: await periodLockHistory() });
  } catch (err) {
    console.error("period lock read failed:", err);
    res.status(500).json({ message: "Failed to load the period lock." });
  }
};

exports.updatePeriodLock = async (req, res) => {
  try {
    const result = await updatePeriodLock(req.body || {});
    const messages = {
      set: `Period locked through ${result.lockedThroughDate}.`,
      moved_forward: `Lock moved forward to ${result.lockedThroughDate}.`,
      moved_back: `Lock moved back to ${result.lockedThroughDate}.`,
      cleared: "Period unlocked.",
    };
    res.json({ message: messages[result.action], ...result, today: todayKey(), history: await periodLockHistory() });
  } catch (err) {
    if (err instanceof PeriodLockInputError) return res.status(err.status).json({ message: err.message });
    console.error("period lock update failed:", err);
    res.status(500).json({ message: "Failed to update the period lock." });
  }
};
