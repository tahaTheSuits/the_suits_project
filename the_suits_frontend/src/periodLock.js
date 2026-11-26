// Shared accounting period lock state (loaded by App, read anywhere).
// The server enforces the lock; the UI uses it to warn and disable early.
import { createContext, useContext } from "react";

export const PeriodLockContext = createContext({
  lockedThroughDate: null,
  today: null,
  history: [],
  reload: async () => {},
  apply: () => {},
});

export const usePeriodLock = () => useContext(PeriodLockContext);

const pad = (n) => String(n).padStart(2, "0");

// Local calendar day "YYYY-MM-DD" of a date-like value ("YYYY-MM-DD" kept).
export const dayKeyOf = (value) => {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const isLockedDate = (value, lockedThroughDate) => {
  if (!lockedThroughDate) return false;
  const day = dayKeyOf(value);
  return Boolean(day && day <= lockedThroughDate);
};

// "today" from the server (hotel business day) when known, else local.
export const isTodayLocked = (lock) => isLockedDate(lock.today || new Date(), lock.lockedThroughDate);

export const lockMessage = (lockedThroughDate) =>
  `The period is locked through ${lockedThroughDate}. Changes dated on or before it are blocked.`;
