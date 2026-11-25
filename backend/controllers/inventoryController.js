const { getCurrentStock } = require("../utils/stock");

// Get Inventory
// GET /api/inventory                       -> active products only
// GET /api/inventory?includeArchived=true  -> active + archived products
// Rows come from the same builder as the Current Stock report.
exports.getInventory = async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === "true";
    res.json(await getCurrentStock({ includeArchived }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};
