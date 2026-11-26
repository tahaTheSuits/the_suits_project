// Period lock status pill + dialog to set, move or clear the lock date
// (PATCH /api/settings/period-lock). Every change is written to the audit
// trail on the server, with the optional reason.
import { useEffect, useRef, useState } from "react";
import { api, getErrorMessage } from "../api.js";
import { usePeriodLock } from "../periodLock.js";

const ACTION_TEXT = {
  set: "Locked",
  moved_forward: "Lock moved forward",
  moved_back: "Lock moved back",
  cleared: "Unlocked",
};
const formatDateTime = (date) =>
  new Date(date).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });

export default function PeriodLockControl() {
  const lock = usePeriodLock();
  const [open, setOpen] = useState(false);
  const locked = Boolean(lock.lockedThroughDate);

  return (
    <>
      <button
        type="button"
        className={`lock-pill ${locked ? "locked" : "open"}`}
        onClick={() => setOpen(true)}
        title="Accounting period lock: click to change"
      >
        {locked ? `🔒 Locked through ${lock.lockedThroughDate}` : "🔓 No period lock"}
      </button>
      {open && <PeriodLockDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function PeriodLockDialog({ onClose }) {
  const lock = usePeriodLock();
  const [date, setDate] = useState(lock.lockedThroughDate || "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const save = async (value) => {
    if (value !== null && !value) return setNotice("Choose the last locked date.");
    const text =
      value === null
        ? `Unlock all periods? Entries on or before ${lock.lockedThroughDate} become editable again.`
        : lock.lockedThroughDate && value < lock.lockedThroughDate
          ? `Move the lock back to ${value}? Entries after ${value} become editable again.`
          : `Lock every stock change dated on or before ${value}?`;
    if (!window.confirm(text)) return;
    setBusy(true);
    setNotice("");
    try {
      const res = await api.patch("/api/settings/period-lock", {
        lockedThroughDate: value,
        reason: reason.trim() || undefined,
        expectedLockedThroughDate: lock.lockedThroughDate,
      });
      lock.apply(res.data);
      setNotice(res.data.message);
      setReason("");
    } catch (err) {
      setNotice(getErrorMessage(err, "Saving the period lock failed"));
      if (err?.response?.status === 409) await lock.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop nested"
      onClick={(e) => {
        e.stopPropagation();
        if (!busy) onClose();
      }}
    >
      <div className="modal lock-modal" role="dialog" aria-modal="true" aria-labelledby="lock-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="lock-title">Accounting period lock</h2>
          <button ref={closeRef} className="modal-close" onClick={onClose} disabled={busy} aria-label="Close">
            ×
          </button>
        </div>
        {notice && <p className="modal-notice">{notice}</p>}
        <p className="modal-summary">
          {lock.lockedThroughDate
            ? `Locked through ${lock.lockedThroughDate}: stock in/out, edits, corrections and reconciliation dated on or before it are blocked.`
            : "No period is locked. All dates can be changed."}
        </p>

        <div className="occupancy-grid lock-grid">
          <label>
            Lock everything up to and including
            <input
              className="input"
              type="date"
              value={date}
              max={lock.today || undefined}
              onChange={(e) => setDate(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="occupancy-note">
            Reason (optional, saved in the audit trail)
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. October closed and reported"
              disabled={busy}
              maxLength={500}
            />
          </label>
        </div>
        <div className="card-actions">
          <button className="btn btn-primary" onClick={() => save(date)} disabled={busy || !date || date === lock.lockedThroughDate}>
            {busy ? "Saving..." : lock.lockedThroughDate ? "Update lock" : "Lock period"}
          </button>
          {lock.lockedThroughDate && (
            <button className="btn btn-danger" onClick={() => save(null)} disabled={busy}>
              Unlock
            </button>
          )}
          <button className="link-btn" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>

        <section className="modal-section">
          <h3>Audit trail</h3>
          {lock.history.length === 0 ? (
            <p className="field-hint">No lock changes yet.</p>
          ) : (
            <ul className="audit-list">
              {lock.history.map((h) => (
                <li key={h._id}>
                  <span className="audit-date">{formatDateTime(h.createdAt)}</span>
                  <span>
                    {ACTION_TEXT[h.action] || h.action}: {h.previous || "none"} → {h.next || "none"}
                  </span>
                  {h.reason && <span className="audit-reason">“{h.reason}”</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
