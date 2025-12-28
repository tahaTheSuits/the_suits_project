const express = require("express");
const router = express.Router();
const { addStockIn } = require("../controllers/stockInController");


router.post("/", addStockIn);

module.exports = router;