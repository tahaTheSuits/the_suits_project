// Ledger reconciliation, period balance and in-place movement editing.
//
//   GET   /api/products/:id/reconciliation   diagnostics (probable causes)
//   POST  /api/products/:id/reconcile        align stored stock / log adjustment
//   GET   /api/reports/stock-balance?from&to opening + in − out + adj = closing
//   PATCH /api/movements/:type/:id           edit a Stock In / Stock Out
const { diagnoseProduct, reconcileProduct, ReconcileError } = require("../utils/reconciliation");
const { buildPeriodBalance } = require("../utils/periodBalance");
const { editMovement, MovementEditError } = require("../utils/movementEdit");
const { ExportError } = require("../utils/exportHelpers");
const { sendIfLocked } = require("../utils/periodLock");

const handle = (label, fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (sendIfLocked(res, err)) return;
    if (err instanceof ReconcileError) return res.status(err.status).json({ message: err.message, ...err.extra });
    if (err instanceof MovementEditError || err instanceof ExportError) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error(`${label}:`, err);
    res.status(500).json({ message: `${label} failed.` });
  }
};

exports.getProductReconciliation = handle("Reconciliation check", async (req, res) => {
  res.json(await diagnoseProduct(req.params.id));
});

exports.reconcile = handle("Reconcile", async (req, res) => {
  res.status(201).json(await reconcileProduct(req.params.id, req.body || {}));
});

exports.getStockBalance = handle("Stock balance report", async (req, res) => {
  res.json(await buildPeriodBalance(req.query));
});

exports.editMovement = handle("Movement edit", async (req, res) => {
  res.json(await editMovement(req.params.type, req.params.id, req.body || {}));
});
