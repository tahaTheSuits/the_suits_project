// Edit a Stock In / Stock Out entry in place (quantity, date, product, note,
// source). The server updates the entry, moves the stored stock by the exact
// difference, refuses anything that would make stock negative, and keeps the
// change in the audit trail (reason required). No delete + re-enter, so no
// duplicate delivery or usage is created.
import { useEffect, useRef, useState } from "react";
import { api, getErrorMessage } from "../api.js";
import { isLockedDate, usePeriodLock } from "../periodLock.js";

const pad = (n) => String(n).padStart(2, "0");
// Date -> "YYYY-MM-DDTHH:mm" in local time (datetime-local input value).
const toLocalInput = (value) => {
  if (!value) return "";
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const signed = (n) => (n > 0 ? `+${n}` : String(n));
const round = (n) => Math.round(n * 1000) / 1000;

// movement: { _id, movementType: "in"|"out", productId, productName, quantity,
//             unit, date, note?, source?, updatedAt? }
export default function MovementEditModal({ movement, products = [], onClose, onSaved }) {
  const initial = {
    productId: String(movement.productId || ""),
    quantity: String(movement.quantity ?? ""),
    date: toLocalInput(movement.date),
    note: movement.note || "",
    source: movement.source || "",
  };
  const [form, setForm] = useState(initial);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const firstFieldRef = useRef(null);
  const isIn = movement.movementType === "in";
  const lock = usePeriodLock();
  const originalLocked = isLockedDate(movement.date, lock.lockedThroughDate);
  const newDateLocked = !originalLocked && form.date && isLockedDate(form.date.slice(0, 10), lock.lockedThroughDate);

  useEffect(() => {
    firstFieldRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && !savingRef.current && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Only products with the same unit can take this entry.
  const choices = products.filter((p) => p.unit === movement.unit && p.isActive !== false);
  if (initial.productId && !choices.some((p) => String(p._id) === initial.productId)) {
    choices.unshift({ _id: initial.productId, product: movement.productName || "Current product", unit: movement.unit });
  }
  const productName = (id) => choices.find((p) => String(p._id) === id)?.product || movement.productName;

  const changed = Object.keys(initial).filter((k) => form[k] !== initial[k] && !(k === "source" && !isIn));
  const qty = Number(form.quantity);
  const qtyValid = form.quantity !== "" && Number.isFinite(qty) && qty >= 0;

  // Preview of the stock effect per product.
  const sign = isIn ? 1 : -1;
  const effects = [];
  if (qtyValid) {
    if (form.productId !== initial.productId) {
      effects.push({ name: productName(initial.productId), delta: round(-sign * movement.quantity) });
      effects.push({ name: productName(form.productId), delta: round(sign * qty) });
    } else if (qty !== Number(movement.quantity)) {
      effects.push({ name: productName(form.productId), delta: round(sign * (qty - movement.quantity)) });
    }
  }

  const save = async () => {
    if (savingRef.current) return;
    if (originalLocked || newDateLocked) return setError(`The period is locked through ${lock.lockedThroughDate}.`);
    if (!changed.length) return setError("Nothing changed.");
    if (!qtyValid) return setError("Quantity must be 0 or more (0 voids the entry).");
    if (!form.date) return setError("Choose a date.");
    if (reason.trim().length < 3) return setError("Enter a reason (at least 3 characters) for the audit trail.");

    const body = { reason: reason.trim() };
    if (movement.updatedAt) body.expectedUpdatedAt = movement.updatedAt;
    if (changed.includes("quantity")) body.quantity = qty;
    if (changed.includes("date")) body.date = new Date(form.date).toISOString();
    if (changed.includes("productId")) body.productId = form.productId;
    if (changed.includes("note")) body.note = form.note;
    if (changed.includes("source")) body.source = form.source;

    savingRef.current = true;
    setBusy(true);
    setError("");
    try {
      const res = await api.patch(`/api/movements/${movement.movementType}/${movement._id}`, body);
      await onSaved?.(res.data);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Saving the edit failed"));
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  };

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  return (
    <div
      className="modal-backdrop nested"
      onClick={(e) => {
        e.stopPropagation(); // may sit inside another modal's backdrop
        if (!busy) onClose();
      }}
    >
      <div className="modal edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="edit-title">Edit {isIn ? "stock in" : "stock out"}</h2>
          <button className="modal-close" onClick={onClose} disabled={busy} aria-label="Close">
            ×
          </button>
        </div>
        {error && <p className="section-error">{error}</p>}
        {originalLocked && (
          <p className="lock-warning">
            🔒 This entry is in a locked period (closed through {lock.lockedThroughDate}) and cannot be edited.
          </p>
        )}
        {newDateLocked && (
          <p className="lock-warning">
            🔒 The new date is inside the locked period (closed through {lock.lockedThroughDate}). Choose a later date.
          </p>
        )}

        <div className="occupancy-grid edit-grid">
          <label>
            Product
            <select ref={firstFieldRef} className="input" value={form.productId} onChange={set("productId")} disabled={busy}>
              {choices.map((p) => (
                <option key={p._id} value={String(p._id)}>
                  {p.product} ({p.unit})
                </option>
              ))}
            </select>
          </label>
          <label>
            Quantity ({movement.unit})
            <input className="input" type="number" min="0" step="any" value={form.quantity} onChange={set("quantity")} disabled={busy} />
          </label>
          <label>
            Date and time
            <input
              className="input"
              type="datetime-local"
              value={form.date}
              onChange={set("date")}
              disabled={busy || originalLocked}
              min={lock.lockedThroughDate ? `${lock.lockedThroughDate}T23:59` : undefined}
            />
          </label>
          {isIn && (
            <label>
              Source
              <input className="input" value={form.source} onChange={set("source")} disabled={busy} />
            </label>
          )}
          <label className="occupancy-note">
            Note
            <input className="input" value={form.note} onChange={set("note")} disabled={busy} maxLength={500} />
          </label>
          <label className="occupancy-note">
            Reason for the edit (required)
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder="e.g. Invoice says 25, not 30"
              disabled={busy}
            />
          </label>
        </div>

        {effects.length > 0 && (
          <p className="field-hint">
            Stock effect: {effects.map((e) => `${e.name} ${signed(e.delta)} ${movement.unit}`).join(" · ")}
            {qty === 0 && " (0 voids the entry)"}
          </p>
        )}
        <p className="field-hint">
          Only products counted in {movement.unit} are listed. Nothing is saved if any stock would become negative.
        </p>

        <div className="card-actions">
          <button className="btn btn-primary" onClick={save} disabled={busy || !changed.length || originalLocked || newDateLocked}>
            {busy ? "Saving..." : "Save changes"}
          </button>
          <button className="link-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
