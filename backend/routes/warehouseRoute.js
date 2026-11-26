const express = require("express");
const router = express.Router();
const { getResetPreview, resetWarehouse } = require("../controllers/warehouseController");

router.get("/reset/preview", getResetPreview);
router.post("/reset", resetWarehouse);

module.exports = router;
