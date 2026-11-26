// Full warehouse wipe dialog (POST /api/warehouse/reset, mode
// "full_warehouse"). Shows what would be deleted, requires typing RESET (or
// WIPE ALL), and hands the result to App so every view is cleared at once.
import { useEffect, useRef, useState } from "react";
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
  return (
    <div
      className="modal-backdrop nested"
      onClick={(e) => {
        e.stopPropagation();
        if (!busyRef.current) onClose();
      }}
    >
      <div className="modal reset-modal" role="alertdialog" aria-modal="true" aria-labelledby="reset-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="reset-title">⚠ Reset All Warehouse Data (Delete Products &amp; History)</h2>
          <button className="modal-close" onClick={onClose} disabled={busy} aria-label="Close">
            ×
          </button>
        </div>

        <div className="reset-warning" role="alert">
          <strong>This cannot be undone.</strong> ALL products, ALL stock in / stock out movements, ALL corrections,
          edits and adjustments, ALL occupancy and consumption data, and every report built from them will be
          permanently deleted. The period lock is cleared. The warehouse will start with zero products.
        </div>

        {error && <p className="section-error">{error}</p>}
        {!preview && !error && <p className="loading-state">Counting what would be deleted...</p>}
        {preview && (
          <>
            <ul className="reset-counts">
              <li><strong>{c.products}</strong> products</li>
              <li><strong>{c.stockIns}</strong> stock in movements</li>
              <li><strong>{c.stockOuts}</strong> stock out movements</li>
              <li><strong>{c.adjustments}</strong> corrections, edits and adjustments</li>
              <li><strong>{c.occupancyDays}</strong> occupancy / consumption days</li>
              {preview.periodLock && <li>period lock through <strong>{preview.periodLock}</strong></li>}
            </ul>
            {preview.enabled === false && (
              <p className="lock-warning">
                Reset is switched off on the server. An administrator must set ALLOW_WAREHOUSE_RESET=true on the API
                before this can run.
              </p>
            )}
          </>
        )}

        <div className="occupancy-grid reset-grid">
          <label className="occupancy-note">
            <span>
              Type <code>RESET</code> (or <code>WIPE ALL</code>) to confirm
            </span>
            <input
              ref={inputRef}
              className="input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && wipe()}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              aria-label="Confirmation phrase"
            />
          </label>
          <label className="occupancy-note">
            Reason (optional, saved in the audit trail)
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
              maxLength={500}
            />
          </label>
        </div>

        <div className="card-actions">
          <button className="btn btn-danger" onClick={wipe} disabled={disabled}>
            {busy ? "Deleting everything..." : "Permanently delete all warehouse data"}
          </button>
          <button className="link-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
