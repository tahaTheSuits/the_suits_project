const express = require("express");
const router = express.Router();
const {
  listOccupancy,
  getOccupancyDay,
  putOccupancyDay,
  syncOccupancy,
  requireSyncToken,
} = require("../controllers/occupancyController");

// No delete route: occupancy history is never removed.
router.get("/", listOccupancy);
router.post("/sync", requireSyncToken, syncOccupancy);
router.get("/:date", getOccupancyDay);
router.put("/:date", putOccupancyDay);

module.exports = router;
