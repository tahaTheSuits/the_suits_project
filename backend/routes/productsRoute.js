const express = require("express");
const router = express.Router();
const {
  createProduct,
  archiveProduct,
  restoreProduct,
} = require("../controllers/productsController");
const {
  updateMinStock,
  getProductMovements,
} = require("../controllers/adjustmentsController");


router.post("/", createProduct);
router.patch("/:id/archive", archiveProduct);
router.patch("/:id/restore", restoreProduct);
router.patch("/:id/min-stock", updateMinStock);
router.get("/:id/movements", getProductMovements);

module.exports = router;
