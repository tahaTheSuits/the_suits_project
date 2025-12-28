const express = require("express");
const router = express.Router();
const { createStockOut } = require("../controllers/stockOutController");




router.post("/", createStockOut);



module.exports = router;