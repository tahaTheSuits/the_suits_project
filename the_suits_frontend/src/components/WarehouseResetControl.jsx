// Full warehouse wipe dialog (POST /api/warehouse/reset, mode
// "full_warehouse"). Shows what would be deleted, requires typing RESET (or
// WIPE ALL), and hands the result to App so every view is cleared at once.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, getErrorMessage } from "../api.js";

const PHRASES = ["RESET", "WIPE ALL"];

// Confirmation dialog for the full warehouse reset (opened from the
// Settings menu).
export default function ResetDialog({ onClose, onReset }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const inputRef = useRef(null);

  useEffect(() => {
    let alive = true;
    api
      .get("/api/warehouse/reset/preview")
      .then((res) => alive && setPreview(res.data))
      .catch((err) => alive && setError(getErrorMessage(err, "Could not load what would be deleted")));
    inputRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && !busyRef.current && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const confirmed = PHRASES.includes(typed);
  const disabled = busy || !confirmed || preview?.enabled === false;

  const wipe = async () => {
    if (disabled || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const res = await api.post(
        "/api/warehouse/reset",
        { mode: "full_warehouse", confirm: typed, reason: reason.trim() || undefined },
        { timeout: 120000 },
      );
      onClose();
      await onReset?.(res.data);
    } catch (err) {
      setError(getErrorMessage(err, "The warehouse reset failed"));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const c = preview?.counts;
  // Rendered into <body>: the top bar uses backdrop-filter, which would
  // otherwise trap this fixed overlay inside the bar and clip it.
  return createPortal(
    <div
      className="reset-overlay"
      onClick={() => {
        if (!busyRef.current) onClose();
      }}
    >
      <div
        className="reset-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="reset-title"
        aria-describedby="reset-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="reset-dialog-head">
          <span className="reset-dialog-icon" aria-hidden="true">
            ⚠
          </span>
          <div>
            <h2 id="reset-title">Reset all warehouse data</h2>
            <p className="reset-dialog-sub">Deletes every product and all history</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label="Close">
            ×
          </button>
        </div>

        <div id="reset-desc" className="reset-dialog-warning" role="alert">
          <strong>This cannot be undone.</strong> All products, stock in / stock out movements, corrections, edits,
          adjustments, occupancy and consumption data, and every report built from them will be permanently deleted.
          The period lock is cleared and the warehouse starts with zero products.
        </div>

        {error && <p className="section-error">{error}</p>}
        {!preview && !error && <p className="loading-state">Counting what would be deleted...</p>}
        {preview && (
          <>
            <ul className="reset-dialog-counts">
              <li><strong>{c.products}</strong><span>products</span></li>
              <li><strong>{c.stockIns}</strong><span>stock in movements</span></li>
              <li><strong>{c.stockOuts}</strong><span>stock out movements</span></li>
              <li><strong>{c.adjustments}</strong><span>corrections &amp; adjustments</span></li>
              <li><strong>{c.occupancyDays}</strong><span>occupancy days</span></li>
              {preview.periodLock && (
                <li><strong>{preview.periodLock}</strong><span>period lock through</span></li>
              )}
            </ul>
            {preview.enabled === false && (
              <p className="lock-warning">
                Reset is switched off on the server. An administrator must set ALLOW_WAREHOUSE_RESET=true on the API
                before this can run.
              </p>
            )}
          </>
        )}

        <label className="reset-dialog-field">
          <span>
            Type <code>RESET</code> to confirm <em>(or WIPE ALL)</em>
          </span>
          <input
            ref={inputRef}
            className="reset-confirm-input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && wipe()}
            placeholder="RESET"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            aria-label="Confirmation phrase"
          />
        </label>
        <label className="reset-dialog-field">
          <span>Reason (optional, saved in the audit trail)</span>
          <input
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            maxLength={500}
          />
        </label>

        <div className="reset-dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={wipe} disabled={disabled}>
            {busy ? "Deleting everything..." : "Confirm Reset"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
