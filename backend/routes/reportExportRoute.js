const express = require("express");
const router = express.Router();
const {
    exportStockOutExcel,
    exportStockInExcel,
    exportStockOutPDF,
    exportStockInPDF,
    exportCurrentStockExcel,
    exportCurrentStockPDF,
    exportOccupancyConsumptionExcel,
    exportOccupancyConsumptionPDF,
} = require("../controllers/reportExportController");

router.get("/occupancy-consumption/excel", exportOccupancyConsumptionExcel);
router.get("/occupancy-consumption/pdf", exportOccupancyConsumptionPDF);

router.get("/current-stock/excel", exportCurrentStockExcel);
router.get("/current-stock/pdf", exportCurrentStockPDF);

router.get("/stock-out/excel", exportStockOutExcel);
router.get("/stock-in/excel", exportStockInExcel);

router.get("/stock-out/pdf", exportStockOutPDF);
router.get("/stock-in/pdf", exportStockInPDF);

// GET /api/export/stock-out (paginated) was removed — use
// GET /api/reports/stock-out?from=YYYY-MM-DD&to=YYYY-MM-DD instead.
router.get("/stock-out", (req, res) =>
    res.status(410).json({
        message: "This endpoint was removed. Use /api/reports/stock-out?from=YYYY-MM-DD&to=YYYY-MM-DD.",
    })
);

module.exports = router;
