const express = require("express");
const router = express.Router();
const { deleteProduct, clearAllData } = require("../controllers/deleteController");

router.delete("/all/data", clearAllData);
router.delete("/:id", deleteProduct);

module.exports = router;