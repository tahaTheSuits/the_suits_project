const express = require("express");
const router = express.Router();
const {
  createProduct,
  archiveProduct,
  restoreProduct,
  updateBarcode,
  getProductByBarcode,
  updateConsumptionRule,
} = require("../controllers/productsController");
const {
  updateMinStock,
  getProductMovements,
} = require("../controllers/adjustmentsController");
const { getProductReconciliation, reconcile } = require("../controllers/reconciliationController");


router.post("/", createProduct);
// Declared before the /:id routes so "by-barcode" is never read as an id.
router.get("/by-barcode/:code", getProductByBarcode);
router.patch("/:id/archive", archiveProduct);
router.patch("/:id/restore", restoreProduct);
router.patch("/:id/min-stock", updateMinStock);
router.patch("/:id/barcode", updateBarcode);
router.patch("/:id/consumption-rule", updateConsumptionRule);
router.get("/:id/movements", getProductMovements);
router.get("/:id/reconciliation", getProductReconciliation);
router.post("/:id/reconcile", reconcile);

module.exports = router;
