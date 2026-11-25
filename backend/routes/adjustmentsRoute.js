const express = require("express");
const router = express.Router();
const {
  createMovementCorrection,
  listAdjustments,
} = require("../controllers/adjustmentsController");

// Append-only: there are intentionally no update/delete routes here.
router.get("/", listAdjustments);
router.post("/movement", createMovementCorrection);

module.exports = router;
