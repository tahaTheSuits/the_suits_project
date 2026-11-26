// Settings menu in the top bar. Rarely used and destructive actions live
// here instead of next to everyday buttons. "Reset warehouse data…" only
// opens the confirmation dialog (type RESET / WIPE ALL); nothing is deleted
// from this menu directly.
import { useEffect, useRef, useState } from "react";
import ResetDialog from "./WarehouseResetControl.jsx";

export default function SettingsMenu({ onReset }) {
  const [open, setOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="settings-menu" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-secondary btn-sm settings-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="Settings"
      >
        <span aria-hidden="true">⚙</span> Settings
      </button>
      {open && (
        <div className="settings-popover" role="menu" aria-label="Settings">
          <p className="settings-heading">Danger zone</p>
          <button
            type="button"
            role="menuitem"
            className="settings-item danger"
            onClick={() => {
              setOpen(false);
              setResetOpen(true);
            }}
          >
            <span className="settings-item-title">Reset warehouse data…</span>
            <span className="settings-item-hint">Delete all products, movements and history (asks for confirmation)</span>
          </button>
        </div>
      )}
      {resetOpen && <ResetDialog onClose={() => setResetOpen(false)} onReset={onReset} />}
    </div>
  );
}
