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
} = require("../controllers/reportController");

router.get("/stock-out/daily", getDailyReport);
router.get("/stock-out/weekly", getWeeklyReport);

router.get("/stock-in/weekly", getWeeklyStockInReport);
router.get("/stock-in/daily", getDailyStockInReport);

router.get("/stock-out", getStockOutByDateRange);
router.get("/stock-in", getStockInByDateRange);





module.exports = router;