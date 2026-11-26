const express = require("express");
const router = express.Router();
const { editMovement } = require("../controllers/reconciliationController");

// :type is "in" or "out". PUT is accepted as an alias of PATCH (partial
// update either way). There is intentionally no delete route.
router.patch("/:type/:id", editMovement);
router.put("/:type/:id", editMovement);

module.exports = router;
