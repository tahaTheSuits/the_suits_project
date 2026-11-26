// Floating toast stack (top-right). Each toast has a unique id and time, so
// rapid repeated actions ("Stock Out: 1 pcs of Soap" three times) each show
// fresh feedback. Auto-dismiss after TOAST_MS via a CSS progress animation:
// hovering the toast pauses it, × closes it immediately.
import { useCallback, useMemo, useRef, useState } from "react";
import { ToastContext } from "../toast.js";

const TOAST_MS = 3500;
const MAX_TOASTS = 5;

const ICONS = { success: "✓", error: "✕", warning: "!", info: "i" };
const TITLES = { success: "Done", error: "Something went wrong", warning: "Check this", info: "Info" };

const timeOf = (ts) => new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  // Toast under the pointer / keyboard focus: its timer is paused.
  const [pausedId, setPausedId] = useState(null);
  const seqRef = useRef(0);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const notify = useCallback((message, type = "success") => {
    if (!message) return null;
    seqRef.current += 1;
    const toast = {
      id: `${Date.now()}-${seqRef.current}`,
      type: ICONS[type] ? type : "info",
      message: String(message),
      createdAt: Date.now(),
    };
    // Newest on top; keep the stack short.
    setToasts((list) => [toast, ...list].slice(0, MAX_TOASTS));
    return toast.id;
  }, []);

  const value = useMemo(() => notify, [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-relevant="additions">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.type}${pausedId === t.id ? " paused" : ""}`}
            role={t.type === "error" ? "alert" : "status"}
            onMouseEnter={() => setPausedId(t.id)}
            onMouseLeave={() => setPausedId((id) => (id === t.id ? null : id))}
            onFocus={() => setPausedId(t.id)}
            onBlur={() => setPausedId((id) => (id === t.id ? null : id))}
          >
            <span className="toast-icon" aria-hidden="true">
              {ICONS[t.type]}
            </span>
            <div className="toast-body">
              <div className="toast-head">
                <strong>{TITLES[t.type]}</strong>
                <time dateTime={new Date(t.createdAt).toISOString()}>{timeOf(t.createdAt)}</time>
              </div>
              <p>{t.message}</p>
            </div>
            <button type="button" className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
              ×
            </button>
            <span
              className="toast-progress"
              style={{ animationDuration: `${TOAST_MS}ms` }}
              onAnimationEnd={() => dismiss(t.id)}
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
