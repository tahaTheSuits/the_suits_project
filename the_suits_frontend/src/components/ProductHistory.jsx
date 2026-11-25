// Product history panel: movements with original vs effective quantities,
// quantity corrections (append-only, reason required), minStock editing,
// and the product's audit trail.
import { useCallback, useEffect, useState } from "react";
import { api, getErrorMessage } from "../api.js";

const formatDate = (date) => new Date(date).toLocaleDateString("en-GB");
const formatDateTime = (date) =>
  new Date(date).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });

const signed = (n) => (n > 0 ? `+${n}` : String(n));

const describeAdjustment = (a) => {
  if (a.kind === "min_stock_change") {
    return `Min stock: ${a.previousMinStock ?? "default"} → ${a.newMinStock ?? "default"}`;
  }
  const unitFix =
    a.originalUnit && a.originalUnit !== a.correctedUnit ? ` (recorded as ${a.originalQuantity} ${a.originalUnit})` : "";
  const label = a.movementType === "in" ? "Stock in" : "Stock out";
  return `${label}: ${a.previousQuantity} → ${a.correctedQuantity} ${a.correctedUnit}${unitFix} · stock ${signed(a.quantityDelta)}`;
};

export default function ProductHistory({ productId, onClose, onChanged }) {
  const [history, setHistory] = useState(null);
  const [adjustments, setAdjustments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState(null); // movement being corrected
  const [correctedQty, setCorrectedQty] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");

  const [minStockInput, setMinStockInput] = useState("");
  const [minStockReason, setMinStockReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [historyRes, adjustmentsRes] = await Promise.allSettled([
      api.get(`/api/products/${productId}/movements`),
      api.get("/api/adjustments", { params: { product: productId } }),
    ]);
    if (historyRes.status === "fulfilled") {
      setHistory(historyRes.value.data);
      const p = historyRes.value.data.product;
      setMinStockInput(p.minStockIsDefault ? "" : String(p.minStock));
      setError("");
    } else {
      setError(getErrorMessage(historyRes.reason, "Failed to load movements"));
    }
    if (adjustmentsRes.status === "fulfilled") setAdjustments(adjustmentsRes.value.data || []);
    setLoading(false);
  }, [productId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const product = history?.product;

  const startCorrection = (movement) => {
    setEditing(movement);
    setCorrectedQty(String(movement.quantity));
    setCorrectionReason("");
    setNotice("");
  };

  const submit = async (request, successText) => {
    setBusy(true);
    setNotice("");
    try {
      await request();
      setNotice(successText);
      await Promise.all([load(), onChanged()]);
      return true;
    } catch (err) {
      setNotice(getErrorMessage(err, "Save failed"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveCorrection = async () => {
    if (correctedQty === "" || Number(correctedQty) < 0) return setNotice("Enter the correct quantity (0 or more).");
    if (correctionReason.trim().length < 3) return setNotice("Enter a reason (at least 3 characters).");
    const ok = await submit(
      () =>
        api.post("/api/adjustments/movement", {
          movementType: editing.movementType,
          movementId: editing._id,
          correctedQuantity: Number(correctedQty),
          reason: correctionReason.trim(),
        }),
      "Correction recorded. The original entry is kept in the history.",
    );
    if (ok) setEditing(null);
  };

  const saveMinStock = async () => {
    const ok = await submit(
      () =>
        api.patch(`/api/products/${productId}/min-stock`, {
          minStock: minStockInput === "" ? null : Number(minStockInput),
          reason: minStockReason.trim() || undefined,
        }),
      "Min stock updated.",
    );
    if (ok) setMinStockReason("");
  };

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{product ? `${product.product} — history` : "Product history"}</h2>
          <button className="modal-close" onClick={onClose} disabled={busy} aria-label="Close">
            ×
          </button>
        </div>

        {error && <p className="section-error">{error}</p>}
        {notice && <p className="modal-notice">{notice}</p>}

        {!history && loading && <p className="loading-state">Loading history...</p>}

        {product && (
          <>
            <p className="modal-summary">
              Available: <strong>{product.quantity} {product.unit}</strong> · In {product.totalIn} · Out{" "}
              {product.totalOut}
              {!product.isActive && " · archived"}
            </p>

            <section className="modal-section">
              <h3>Min stock</h3>
              <div className="from-row">
                <input
                  className="input"
                  type="number"
                  min="0"
                  placeholder="Default (5)"
                  value={minStockInput}
                  onChange={(e) => setMinStockInput(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="Reason (optional)"
                  value={minStockReason}
                  onChange={(e) => setMinStockReason(e.target.value)}
                />
                <button className="btn btn-primary" onClick={saveMinStock} disabled={busy}>
                  Save
                </button>
              </div>
              <p className="field-hint">
                Currently {product.minStock} {product.unit}
                {product.minStockIsDefault ? " (default)" : ""}. Leave empty to use the default.
              </p>
            </section>

            <section className="modal-section">
              <h3>Movements</h3>
              <p className="field-hint">
                Corrections never change the original entry: they record the true quantity (in{" "}
                {product.unit}) with a reason. Enter 0 to void an entry.
              </p>
              <div className="table-wrapper">
                <table className="reports-table history-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Recorded</th>
                      <th>Counted as</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.movements.length === 0 && (
                      <tr>
                        <td colSpan={5}>No movements yet.</td>
                      </tr>
                    )}
                    {history.movements.map((m) => (
                      <tr key={m._id} className={m.unitConflict ? "conflict-row" : undefined}>
                        <td data-label="Date">{formatDate(m.date)}</td>
                        <td data-label="Type">{m.movementType === "in" ? "Stock in" : "Stock out"}</td>
                        <td data-label="Recorded">
                          {m.originalQuantity} {m.originalUnit}
                          {m.unitConflict && <span className="unit-warning">⚠ different unit</span>}
                        </td>
                        <td data-label="Counted as">
                          {m.quantity} {m.unit}
                          {m.corrected && (
                            <span className="corrected-tag" title={m.corrections.at(-1)?.reason}>
                              corrected ×{m.corrections.length}
                            </span>
                          )}
                        </td>
                        <td data-label="">
                          {editing?._id === m._id ? null : (
                            <button className="link-btn" onClick={() => startCorrection(m)} disabled={busy}>
                              Correct
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {history.limited && <p className="field-hint">Showing the most recent movements only.</p>}

              {editing && (
                <div className="correction-form">
                  <p>
                    Correct {editing.movementType === "in" ? "stock in" : "stock out"} of{" "}
                    {formatDate(editing.date)} (counted as {editing.quantity} {product.unit}
                    {editing.unitConflict ? `, recorded as ${editing.originalQuantity} ${editing.originalUnit}` : ""}):
                  </p>
                  <div className="from-row">
                    <input
                      className="input"
                      type="number"
                      min="0"
                      placeholder={`True quantity (${product.unit})`}
                      value={correctedQty}
                      onChange={(e) => setCorrectedQty(e.target.value)}
                    />
                    <input
                      className="input"
                      placeholder="Reason (required)"
                      value={correctionReason}
                      onChange={(e) => setCorrectionReason(e.target.value)}
                    />
                    <button className="btn btn-primary" onClick={saveCorrection} disabled={busy}>
                      {busy ? "Saving..." : "Save correction"}
                    </button>
                    <button className="link-btn" onClick={() => setEditing(null)} disabled={busy}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>

            <section className="modal-section">
              <h3>Audit trail</h3>
              {adjustments.length === 0 ? (
                <p className="field-hint">No corrections or min stock changes yet.</p>
              ) : (
                <ul className="audit-list">
                  {adjustments.map((a) => (
                    <li key={a._id}>
                      <span className="audit-date">{formatDateTime(a.createdAt)}</span>
                      <span>{describeAdjustment(a)}</span>
                      {a.reason && <span className="audit-reason">“{a.reason}”</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
