const express = require("express");
const router = express.Router();
const {
    exportStockOutExcel,
    exportStockInExcel,
    exportStockOutPDF,
    exportStockInPDF,
    getStockOutReport,
    exportCurrentStockExcel,
    exportCurrentStockPDF,
} = require("../controllers/reportExportController");

router.get("/current-stock/excel", exportCurrentStockExcel);
router.get("/current-stock/pdf", exportCurrentStockPDF);

router.get("/stock-out/excel", exportStockOutExcel);
router.get("/stock-in/excel", exportStockInExcel);

router.get("/stock-out/pdf", exportStockOutPDF);
router.get("/stock-in/pdf", exportStockInPDF);

router.get("/stock-out", getStockOutReport);

module.exports = router;