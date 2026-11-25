const express = require("express");
const router = express.Router();
const {
  createProduct,
  archiveProduct,
  restoreProduct,
  updateBarcode,
  getProductByBarcode,
} = require("../controllers/productsController");
const {
  updateMinStock,
  getProductMovements,
} = require("../controllers/adjustmentsController");


router.post("/", createProduct);
// Declared before the /:id routes so "by-barcode" is never read as an id.
router.get("/by-barcode/:code", getProductByBarcode);
router.patch("/:id/archive", archiveProduct);
router.patch("/:id/restore", restoreProduct);
router.patch("/:id/min-stock", updateMinStock);
router.patch("/:id/barcode", updateBarcode);
router.get("/:id/movements", getProductMovements);

module.exports = router;
