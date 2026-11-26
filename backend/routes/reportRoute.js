// routes/reportRoutes.js
const express = require("express");
const router = express.Router();
const {
    getDailyReport,
    getWeeklyReport,
    getWeeklyStockInReport,
    getDailyStockInReport, 
    getStockOutByDateRange,
    getStockInByDateRange,
    getCurrentStockReport,
    getOccupancyConsumptionReport,
} = require("../controllers/reportController");
const { getStockBalance } = require("../controllers/reconciliationController");

router.get("/occupancy-consumption", getOccupancyConsumptionReport);

router.get("/current-stock", getCurrentStockReport);
router.get("/stock-balance", getStockBalance);

router.get("/stock-out/daily", getDailyReport);
router.get("/stock-out/weekly", getWeeklyReport);

router.get("/stock-in/weekly", getWeeklyStockInReport);
router.get("/stock-in/daily", getDailyStockInReport);

router.get("/stock-out", getStockOutByDateRange);
router.get("/stock-in", getStockInByDateRange);





module.exports = router;