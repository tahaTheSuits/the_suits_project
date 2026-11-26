// Ledger check badge (✓ Balanced / ⚠ Mismatch: ±diff) for one product.
// Clicking it opens the reconciliation breakdown: ledger totals, probable
// causes with suggestions, and the two audited fixes (align the stored stock
// with the ledger, or log a documented stock adjustment).
import { useCallback, useEffect, useRef, useState } from "react";
import { api, getErrorMessage } from "../api.js";

const signed = (n) => (n > 0 ? `+${n}` : String(n));
const formatDate = (date) => new Date(date).toLocaleDateString("en-GB");
const formatDateTime = (date) =>
  new Date(date).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });

const TYPE_LABEL = { in: "Stock in", out: "Stock out", adjustment: "Adjustment" };

export default function LedgerCheck({ productId, productName, reconciliation, onChanged, compact = false }) {
  const [open, setOpen] = useState(false);
  if (!reconciliation) return null;
  const balanced = reconciliation.balanced;
  const label = balanced ? "✓ Balanced" : `⚠ Mismatch: ${signed(reconciliation.difference ?? 0)}`;
  return (
    <>
      <button
        type="button"
        className={`ledger-badge ${balanced ? "balanced" : "mismatch"}${compact ? " compact" : ""}`}
        onClick={() => setOpen(true)}
        title={
          balanced
            ? "Stored stock matches the ledger (stock in − stock out + adjustments). Click for details."
            : `Stored stock ${reconciliation.current} vs ledger ${reconciliation.expected}. Click for probable causes and fixes.`
        }
      >
        {label}
      </button>
      {open && (
        <ReconcileModal
          productId={productId}
          productName={productName}
          onClose={() => setOpen(false)}
          onChanged={onChanged}
        />
      )}
    </>
  );
}

function CauseCard({ cause, unit }) {
  return (
    <li className={`cause-card ${cause.likelihood}`}>
      <div className="cause-head">
        <strong>{cause.title}</strong>
        <span className={`likelihood ${cause.likelihood}`}>{cause.likelihood}</span>
      </div>
      <p>{cause.detail}</p>
      {cause.groups && (
        <ul className="cause-items">
          {cause.groups.map((g, i) => (
            <li key={i}>
              {TYPE_LABEL[g.type]} of {g.quantity} {unit}:{" "}
              {g.items.map((item) => formatDateTime(item.date)).join(" · ")}
            </li>
          ))}
        </ul>
      )}
      {cause.firstNegative && (
        <ul className="cause-items">
          <li>
            First below zero after: {TYPE_LABEL[cause.firstNegative.type]} of {cause.firstNegative.quantity} {unit} on{" "}
            {formatDateTime(cause.firstNegative.date)} (balance {cause.firstNegative.balance})
          </li>
        </ul>
      )}
      <p className="cause-suggestion">→ {cause.suggestion}</p>
    </li>
  );
}

export function ReconcileModal({ productId, productName, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [delta, setDelta] = useState("");
  const closeRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/api/products/${productId}/reconciliation`);
      setData(res.data);
      setDelta(res.data.reconciliation.difference ? String(res.data.reconciliation.difference) : "");
      setError("");
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load the ledger check"));
    }
  }, [productId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const apply = async (action) => {
    const r = data.reconciliation;
    const unit = data.product.unit;
    if (reason.trim().length < 3) return setNotice("Enter a reason (at least 3 characters) for the audit trail.");
    let body = { action, reason: reason.trim(), expectedCurrent: r.current, expectedLedger: r.expected };
    if (action === "align_stock") {
      if (!window.confirm(`Set the stored stock of "${data.product.name}" from ${r.current} to the ledger balance ${r.expected} ${unit}?`)) return;
    } else {
      const n = Number(delta);
      if (delta === "" || !Number.isFinite(n) || n === 0) return setNotice("Enter a non-zero adjustment (+ adds stock, − removes stock).");
      if (!window.confirm(`Log a stock adjustment of ${signed(n)} ${unit} for "${data.product.name}"? The ledger becomes ${Math.round((r.expected + n) * 1000) / 1000} ${unit}.`)) return;
      body = { ...body, quantityDelta: n };
    }
    setBusy(true);
    setNotice("");
    try {
      const res = await api.post(`/api/products/${productId}/reconcile`, body);
      setNotice(res.data.message);
      setReason("");
      await Promise.all([load(), onChanged?.()]);
    } catch (err) {
      setNotice(getErrorMessage(err, "Reconcile failed"));
      if (err?.response?.status === 409) await load();
    } finally {
      setBusy(false);
    }
  };

  const r = data?.reconciliation;
  const unit = data?.product.unit || "";

  return (
    <div
      className="modal-backdrop nested"
      onClick={(e) => {
        e.stopPropagation();
        if (!busy) onClose();
      }}
    >
      <div className="modal reconcile-modal" role="dialog" aria-modal="true" aria-labelledby="reconcile-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="reconcile-title">Ledger check — {data?.product.name || productName}</h2>
          <button ref={closeRef} className="modal-close" onClick={onClose} disabled={busy} aria-label="Close">
            ×
          </button>
        </div>
        {error && <p className="section-error">{error}</p>}
        {notice && <p className="modal-notice">{notice}</p>}
        {!data && !error && <p className="loading-state">Checking the ledger...</p>}

        {data && (
          <>
            <div className={`day-status-banner ${r.balanced ? "ok" : "paused"}`} role="note">
              <strong>
                {r.balanced
                  ? `✓ Balanced: stored stock equals the ledger (${r.expected} ${unit}).`
                  : `⚠ Mismatch of ${signed(r.difference)} ${unit}: stored ${r.current}, ledger ${r.expected}.`}
              </strong>
              <span>
                Ledger = stock in {data.ledger.totalIn} − stock out {data.ledger.totalOut}
                {data.ledger.totalAdjusted ? ` ${data.ledger.totalAdjusted < 0 ? "−" : "+"} adjustments ${Math.abs(data.ledger.totalAdjusted)}` : ""} ={" "}
                {data.ledger.quantity} {unit} · {data.movementCount} entries
              </span>
            </div>

            <section className="modal-section">
              <h3>{r.balanced ? "History checks" : "Probable causes"}</h3>
              {data.causes.length === 0 ? (
                <p className="empty-state">No issues found in this product's history.</p>
              ) : (
                <ul className="cause-list">
                  {data.causes.map((c) => (
                    <CauseCard key={c.code} cause={c} unit={unit} />
                  ))}
                </ul>
              )}
              <p className="field-hint">
                Duplicates and past negative balances are fixed by editing the entry in the product's History (set a
                double entry to 0, or correct its date).
              </p>
            </section>

            <section className="modal-section">
              <h3>Reconcile</h3>
              <label className="reconcile-reason">
                Reason (saved in the audit trail)
                <input
                  className="input"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Opening stock was never logged"
                  disabled={busy}
                />
              </label>
              <div className="reconcile-options">
                <div className="reconcile-option">
                  <strong>Align stored stock with the ledger</strong>
                  <p className="field-hint">
                    Use when the movements are right and the stored number is wrong. Stored {r.current} → {r.expected}{" "}
                    {unit}; no movement is added.
                  </p>
                  <button className="btn btn-primary" onClick={() => apply("align_stock")} disabled={busy || r.balanced}>
                    {busy ? "Saving..." : "Align with ledger"}
                  </button>
                </div>
                <div className="reconcile-option">
                  <strong>Log a stock adjustment</strong>
                  <p className="field-hint">
                    Use when the stored count is right but a movement was never logged (e.g. opening stock). Adds a
                    documented adjustment to the ledger{r.balanced ? "" : `; ${signed(r.difference)} makes it match the stored stock`}.
                  </p>
                  <div className="from-row">
                    <input
                      className="input"
                      type="number"
                      step="any"
                      value={delta}
                      onChange={(e) => setDelta(e.target.value)}
                      placeholder={`± quantity (${unit})`}
                      disabled={busy}
                      aria-label="Adjustment quantity"
                    />
                    <button className="btn btn-primary" onClick={() => apply("log_adjustment")} disabled={busy}>
                      {busy ? "Saving..." : "Log adjustment"}
                    </button>
                  </div>
                </div>
              </div>
            </section>
            {data.product.createdAt && <p className="field-hint">Product created {formatDate(data.product.createdAt)}.</p>}
          </>
        )}
      </div>
    </div>
  );
}
