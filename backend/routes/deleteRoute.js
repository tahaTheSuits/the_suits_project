const express = require("express");
const router = express.Router();
const { deleteProduct } = require("../controllers/deleteController");

router.delete("/:id", deleteProduct);

module.exports = router;