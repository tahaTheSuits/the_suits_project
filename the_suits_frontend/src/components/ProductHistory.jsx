// Product history panel: movements with original vs effective quantities,
// in-place editing of entries (audited, reason required), minStock editing,
// and the product's audit trail.
import { useCallback, useEffect, useState } from "react";
import { api, basisInfo, CONSUMPTION_BASES, getErrorMessage, inferConsumptionBasis } from "../api.js";
import MovementEditModal from "./MovementEditModal.jsx";

const formatDate = (date) => new Date(date).toLocaleDateString("en-GB");
const formatDateTime = (date) =>
  new Date(date).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });

const signed = (n) => (n > 0 ? `+${n}` : String(n));

const describeAdjustment = (a) => {
  if (a.kind === "min_stock_change") {
    return `Min stock: ${a.previousMinStock ?? "default"} → ${a.newMinStock ?? "default"}`;
  }
  if (a.kind === "barcode_change") {
    return `Barcode: ${a.previousBarcode || "none"} → ${a.newBarcode || "none"}`;
  }
  if (a.kind === "consumption_rule_change") {
    const text = (r) =>
      r
        ? `${basisInfo(r.basis).label}${r.inferred ? " (auto)" : ""}${r.normalMaxThreshold !== null && r.normalMaxThreshold !== undefined ? `, max ${r.normalMaxThreshold}` : ""}`
        : "—";
    return `Consumption alerts: ${text(a.previousRule)} → ${text(a.newRule)}`;
  }
  if (a.kind === "stock_adjustment") {
    return `Stock adjustment ${signed(a.quantityDelta)} ${a.unit || ""} (ledger ${a.ledgerQuantity} → ${a.newCachedQuantity})`;
  }
  if (a.kind === "cache_reconcile") {
    return `Stored stock aligned with the ledger: ${a.previousCachedQuantity} → ${a.newCachedQuantity} ${a.unit || ""}`;
  }
  if (a.kind === "movement_edit") {
    const label = a.movementType === "in" ? "Stock in" : "Stock out";
    const c = a.changes || {};
    const parts = [];
    if (c.date) parts.push(`date ${formatDate(c.date.from)} → ${formatDate(c.date.to)}`);
    if (c.product) parts.push(`product ${c.product.fromName} → ${c.product.toName}`);
    if (c.note) parts.push(`note “${c.note.from || "—"}” → “${c.note.to || "—"}”`);
    if (c.source) parts.push(`source ${c.source.from || "—"} → ${c.source.to || "—"}`);
    return `${label} edited: ${parts.join(", ")}`;
  }
  const unitFix =
    a.originalUnit && a.originalUnit !== a.correctedUnit ? ` (recorded as ${a.originalQuantity} ${a.originalUnit})` : "";
  const label = a.movementType === "in" ? "Stock in" : "Stock out";
  return `${label}: ${a.previousQuantity} → ${a.correctedQuantity} ${a.correctedUnit}${unitFix} · stock ${signed(a.quantityDelta)}`;
};

const TYPE_LABEL = { in: "Stock in", out: "Stock out", adjustment: "Adjustment" };

export default function ProductHistory({ productId, products = [], onClose, onChanged }) {
  const [history, setHistory] = useState(null);
  const [adjustments, setAdjustments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState(null); // movement being edited

  const [minStockInput, setMinStockInput] = useState("");
  const [minStockReason, setMinStockReason] = useState("");

  const [barcodeInput, setBarcodeInput] = useState("");
  const [barcodeReason, setBarcodeReason] = useState("");

  const [ruleBasis, setRuleBasis] = useState(""); // "" = auto from name
  const [ruleThreshold, setRuleThreshold] = useState("");
  const [ruleReason, setRuleReason] = useState("");

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
      setBarcodeInput(p.barcode || "");
      setRuleBasis(p.consumptionBasisInferred ? "" : p.consumptionBasis || "");
      setRuleThreshold(p.normalMaxThreshold === null || p.normalMaxThreshold === undefined ? "" : String(p.normalMaxThreshold));
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
    const onKey = (e) => e.key === "Escape" && !busy && !editing && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, editing, onClose]);

  const product = history?.product;

  const startEdit = (movement) => {
    setNotice("");
    setEditing({ ...movement, productName: product?.product });
  };

  const afterEdit = async (result) => {
    setNotice(result?.message ? `${result.message} The change is kept in the audit trail.` : "Entry updated.");
    await Promise.all([load(), onChanged()]);
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

  const saveRule = async () => {
    if (ruleThreshold !== "" && !(Number(ruleThreshold) > 0)) return setNotice("Normal max must be a positive number, or empty.");
    const ok = await submit(
      () =>
        api.patch(`/api/products/${productId}/consumption-rule`, {
          consumptionBasis: ruleBasis || null,
          normalMaxThreshold: ruleThreshold === "" ? null : Number(ruleThreshold),
          reason: ruleReason.trim() || undefined,
        }),
      "Consumption alert rule saved.",
    );
    if (ok) setRuleReason("");
  };

  // Empty input removes the barcode. Trimmed only (leading zeros kept).
  const saveBarcode = async (value) => {
    const ok = await submit(
      () =>
        api.patch(`/api/products/${productId}/barcode`, {
          barcode: value.trim() || null,
          reason: barcodeReason.trim() || undefined,
        }),
      value.trim() ? "Barcode saved." : "Barcode removed.",
    );
    if (ok) setBarcodeReason("");
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
              <h3>Barcode</h3>
              <div className="from-row">
                <input
                  className="input"
                  placeholder="Scan or type barcode"
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (!busy) saveBarcode(barcodeInput);
                    }
                  }}
                  autoComplete="off"
                  spellCheck={false}
                />
                <input
                  className="input"
                  placeholder="Reason (optional)"
                  value={barcodeReason}
                  onChange={(e) => setBarcodeReason(e.target.value)}
                />
                <button className="btn btn-primary" onClick={() => saveBarcode(barcodeInput)} disabled={busy}>
                  Save
                </button>
                {product.barcode && (
                  <button className="link-btn" onClick={() => saveBarcode("")} disabled={busy}>
                    Remove
                  </button>
                )}
              </div>
              <p className="field-hint">
                {product.barcode ? `Current barcode: ${product.barcode}.` : "No barcode yet (optional)."} Each
                barcode can belong to only one active product.
              </p>
            </section>

            <section className="modal-section">
              <h3>Consumption alerts</h3>
              <div className="from-row">
                <select value={ruleBasis} onChange={(e) => setRuleBasis(e.target.value)} aria-label="Alert basis">
                  <option value="">Auto from name ({basisInfo(inferConsumptionBasis(product.product)).label})</option>
                  {CONSUMPTION_BASES.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
                {(ruleBasis || inferConsumptionBasis(product.product)) !== "none" && (
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="any"
                    placeholder={`Normal max ${basisInfo(ruleBasis || inferConsumptionBasis(product.product)).rate} (optional)`}
                    value={ruleThreshold}
                    onChange={(e) => setRuleThreshold(e.target.value)}
                    aria-label="Normal maximum"
                  />
                )}
                <input
                  className="input"
                  placeholder="Reason (optional)"
                  value={ruleReason}
                  onChange={(e) => setRuleReason(e.target.value)}
                />
                <button className="btn btn-primary" onClick={saveRule} disabled={busy}>
                  Save
                </button>
              </div>
              <p className="field-hint">
                Currently: {basisInfo(product.consumptionBasis).label}
                {product.consumptionBasisInferred ? " (auto from the name)" : ""}
                {product.consumptionBasis === "none"
                  ? " — never flagged."
                  : product.normalMaxThreshold
                    ? ` — flagged above ${product.normalMaxThreshold} ${product.unit} ${basisInfo(product.consumptionBasis).rate}.`
                    : ` — flagged above 1.5× its period average ${basisInfo(product.consumptionBasis).rate} (days with more than 2 ${product.unit}).`}{" "}
                Any use on Sundays, holidays or with 0 of that service is also flagged.
              </p>
            </section>

            <section className="modal-section">
              <h3>Movements</h3>
              <p className="field-hint">
                Edit fixes an entry in place (quantity in {product.unit}, date, product or note) with a reason;
                the stock moves by the exact difference and every change stays in the audit trail. Enter 0 to void
                an entry.
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
                        <td data-label="Type">
                          {TYPE_LABEL[m.movementType]}
                          {m.editedAt && (
                            <span className="corrected-tag" title={`Edited ${formatDateTime(m.editedAt)}`}>
                              edited
                            </span>
                          )}
                        </td>
                        <td data-label="Recorded">
                          {m.movementType === "adjustment" ? signed(m.originalQuantity) : m.originalQuantity} {m.originalUnit}
                          {m.unitConflict && <span className="unit-warning">⚠ different unit</span>}
                        </td>
                        <td data-label="Counted as">
                          {m.movementType === "adjustment" ? signed(m.quantity) : m.quantity} {m.unit}
                          {m.movementType === "adjustment" && m.note && <span className="muted"> · {m.note}</span>}
                          {m.corrected && (
                            <span className="corrected-tag" title={m.corrections.at(-1)?.reason}>
                              corrected ×{m.corrections.length}
                            </span>
                          )}
                        </td>
                        <td data-label="">
                          {m.movementType !== "adjustment" && (
                            <button className="link-btn" onClick={() => startEdit(m)} disabled={busy}>
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {history.limited && <p className="field-hint">Showing the most recent movements only.</p>}

            </section>

            <section className="modal-section">
              <h3>Audit trail</h3>
              {adjustments.length === 0 ? (
                <p className="field-hint">No edits, adjustments or min stock changes yet.</p>
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
      {editing && (
        <MovementEditModal movement={editing} products={products} onClose={() => setEditing(null)} onSaved={afterEdit} />
      )}
    </div>
  );
}
