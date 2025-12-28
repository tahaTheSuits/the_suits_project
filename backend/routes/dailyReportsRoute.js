// routes/dailyReportsRoute.js
const express = require("express");
const router = express.Router();
const { getDailyReport, getWeeklyReport } = require("../controllers/reportController");

router.get("/", getDailyReport);       // /api/daily-reports
router.get("/weekly", getWeeklyReport); // /api/weekly-reports

module.exports = router;