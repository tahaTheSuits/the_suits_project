const express = require("express");
const router = express.Router();
const { getPeriodLock, updatePeriodLock } = require("../controllers/settingsController");

router.get("/period-lock", getPeriodLock);
router.patch("/period-lock", updatePeriodLock);

module.exports = router;
