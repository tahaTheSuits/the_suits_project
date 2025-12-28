const express = require("express");
const router = express.Router();
const {
    exportStockOutExcel,
    exportStockInExcel,
    exportStockOutPDF,
    exportStockInPDF,
    getStockOutReport,
} = require("../controllers/reportExportController");

router.get("/stock-out/excel", exportStockOutExcel);
router.get("/stock-in/excel", exportStockInExcel);

router.get("/stock-out/pdf", exportStockOutPDF);
router.get("/stock-in/pdf", exportStockInPDF);

router.get("/stock-out", getStockOutReport);

module.exports = router;