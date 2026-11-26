// Warehouse administration.
//   GET  /api/warehouse/reset/preview  counts that a full reset would delete
//   POST /api/warehouse/reset          { mode: "full_warehouse", confirm: "RESET" | "WIPE ALL", reason? }
// See utils/warehouseReset.js for what is deleted and the safety rules.
const { fullWarehouseReset, resetPreview, ResetError } = require("../utils/warehouseReset");

exports.getResetPreview = async (req, res) => {
  try {
    res.json(await resetPreview());
  } catch (err) {
    console.error("reset preview failed:", err);
    res.status(500).json({ message: "Failed to load the reset preview." });
  }
};

exports.resetWarehouse = async (req, res) => {
  try {
    const result = await fullWarehouseReset(req.body || {});
    console.warn(`[warehouse] FULL RESET done: ${JSON.stringify(result.deleted)}`);
    res.json(result);
  } catch (err) {
    if (err instanceof ResetError) return res.status(err.status).json({ message: err.message, code: err.code });
    console.error("warehouse reset failed:", err);
    res.status(500).json({ message: "Warehouse reset failed." });
  }
};
