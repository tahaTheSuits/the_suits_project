const express = require("express");
const router = express.Router();
const {
  listOccupancy,
  getOccupancyDay,
  getOccupancyDayDetails,
  putOccupancyDay,
  syncOccupancy,
  requireSyncToken,
} = require("../controllers/occupancyController");
const { pullFromDashboard } = require("../controllers/dashboardSyncController");

// No delete route: occupancy history is never removed.
router.get("/", listOccupancy);
// Push: the dashboard sends records to the warehouse.
router.post("/sync", requireSyncToken, syncOccupancy);
// Pull: the warehouse fetches records from the dashboard (UI button).
router.post("/pull-dashboard", pullFromDashboard);
router.get("/:date/details", getOccupancyDayDetails);
router.get("/:date", getOccupancyDay);
router.put("/:date", putOccupancyDay);

module.exports = router;
