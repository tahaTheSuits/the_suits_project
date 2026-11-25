const express = require("express");
const router = express.Router();
const {
  createProduct,
  archiveProduct,
  restoreProduct,
} = require("../controllers/productsController");


router.post("/", createProduct);
router.patch("/:id/archive", archiveProduct);
router.patch("/:id/restore", restoreProduct);

module.exports = router;
