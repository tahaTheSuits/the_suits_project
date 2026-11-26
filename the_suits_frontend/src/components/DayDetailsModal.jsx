// Details for one business day of the Consumption vs Occupancy report:
// day status (Sunday / holiday / paused cleaning), occupancy and service
// counts with apartment numbers, the warehouse stock outs recorded that day
// and a link to the same day in the admin dashboard.
import { useEffect, useRef, useState } from "react";
import { api, DASHBOARD_NOT_CONFIGURED, dashboardDayUrl, getErrorMessage } from "../api.js";
import { dayBadge } from "../dayStatus.js";

const gb = (key) => key.split("-").reverse().join("/");
const dash = (v) => (v === null || v === undefined ? "–" : v);
const CHIP_LIMIT = 40;
const ANOMALY_TITLE = {
  threshold: "Above the normal maximum",
  spike: "Above the period average",
  zero_service: "No service that day",
  non_service_day: "No service scheduled",
};

// "per housekeeping room: 3.2 pcs (16 ÷ 5 rooms) · limit 2" etc.
function AnomalyFigures({ r }) {
  const parts = [];
  if (r.type === "non_service_day") parts.push(`${r.quantity} ${r.unit} on a ${r.dayType}`);
  else if (r.type === "zero_service") parts.push(`${r.quantity} ${r.unit} with 0 ${r.countLabel}`);
  else if (r.comparison) {
    // e.g. "1.10 vs max 0.90 per housekeeping room" + how the rate was made
    parts.push(r.comparison);
    if (r.basis !== "fixed") parts.push(`${r.quantity} ${r.unit} ÷ ${r.count} ${r.countLabel}`);
  } else {
    parts.push(r.basis === "fixed" ? `${r.quantity} ${r.unit} today` : `${r.rate} ${r.unit} (${r.quantity} ÷ ${r.count} ${r.countLabel})`);
    if (r.threshold !== null && r.threshold !== undefined) parts.push(`max ${r.threshold}`);
    else if (r.average !== null && r.average !== undefined) parts.push(`period average ${r.average}`);
  }
  return (
    <span className="anomaly-figures">
      <span className={`basis-tag ${r.basis}`}>
        {r.basis === "fixed" ? (r.type === "threshold" ? "daily cap" : "per day") : r.basisLabel}
      </span>
      {parts.join(" · ")}
    </span>
  );
}

const longDate = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
};

const timeOf = (iso, timeZone) => {
  try {
    return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
  } catch {
    return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
};

function pausedReason(meta) {
  if (meta.isHoliday) return `Holiday: ${meta.holidayName || "public holiday"}`;
  if (meta.isSunday) return "Sunday (No scheduled cleaning)";
  return meta.noServiceReason || "No scheduled cleaning";
}

// The dashboard's own reason, unless it only repeats the main reason.
function extraReason(meta) {
  const extra = meta.noServiceReason;
  if (!extra) return null;
  return pausedReason(meta).toLowerCase().includes(extra.toLowerCase()) ? null : extra;
}

function ApartmentList({ numbers }) {
  const [showAll, setShowAll] = useState(false);
  if (!numbers?.length) return null;
  const visible = showAll ? numbers : numbers.slice(0, CHIP_LIMIT);
  return (
    <div className="apt-chips">
      {visible.map((n) => (
        <span key={n} className="apt-chip">
          {n}
        </span>
      ))}
      {numbers.length > CHIP_LIMIT && (
        <button className="link-btn" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show fewer" : `+${numbers.length - CHIP_LIMIT} more`}
        </button>
      )}
    </div>
  );
}

export function DashboardLink({ date, compact = false }) {
  const href = dashboardDayUrl(date);
  const label = compact ? "↗" : "Open in Dashboard ↗";
  if (!href) {
    return (
      <span
        className={compact ? "dashboard-link compact disabled" : "btn btn-primary dashboard-link disabled"}
        title={DASHBOARD_NOT_CONFIGURED}
        aria-disabled="true"
      >
        {label}
      </span>
    );
  }
  return (
    <a
      className={compact ? "dashboard-link compact" : "btn btn-primary dashboard-link"}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${gb(date)} in the admin dashboard (new tab)`}
      aria-label={compact ? `Open ${gb(date)} in the admin dashboard` : undefined}
    >
      {label}
    </a>
  );
}

export default function DayDetailsModal({ day, onClose, onEdit }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const closeRef = useRef(null);

  useEffect(() => {
    // The modal is keyed by date, so loading/error start fresh per day.
    const controller = new AbortController();
    api
      .get(`/api/occupancy/${day.date}/details`, { signal: controller.signal })
      .then((res) => setDetails(res.data))
      .catch((err) => {
        if (!controller.signal.aborted) setError(getErrorMessage(err, "Failed to load the stock outs for this day"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [day.date]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Fresh server data when loaded; the report row meanwhile (same shape).
  const record = details ? details.record : day.hasRecord ? day : null;
  const meta = details?.meta || day;
  const breakdown = meta.breakdown || {};
  const badge = dayBadge(meta);

  const rows = [
    {
      label: "Occupied / total",
      value: record ? `${dash(record.occupiedApartments)} / ${dash(record.totalApartments)}` : "–",
      numbers: breakdown.occupiedApartmentNumbers,
    },
    { label: "Vacant", value: dash(record?.vacantApartments) },
    { label: "Check-ins", value: dash(record?.checkIns), numbers: breakdown.checkInApartmentNumbers },
    { label: "Check-outs", value: dash(record?.checkOuts), numbers: breakdown.checkOutApartmentNumbers },
    { label: "Serviced apartments", value: dash(record?.servicedApartments), numbers: breakdown.servicedApartmentNumbers },
    { label: "Housekeeping", value: dash(record?.housekeepingCount), numbers: breakdown.housekeepingApartmentNumbers },
    { label: "Laundry", value: dash(record?.laundryCount), numbers: breakdown.laundryApartmentNumbers },
    { label: "Water", value: dash(record?.waterCount), numbers: breakdown.waterApartmentNumbers },
    {
      label: "Paused service",
      value: record ? meta.pausedServiceApartments || 0 : "–",
      numbers: breakdown.pausedServiceApartments,
    },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal day-details"
        role="dialog"
        aria-modal="true"
        aria-labelledby="day-details-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id="day-details-title">{longDate(day.date)}</h2>
            <p className="modal-summary">
              {gb(day.date)}
              {badge && <span className={`day-badge ${badge.kind}`}>{badge.text}</span>}
              {record && (
                <span className="field-hint">
                  {" "}
                  · {record.source === "manual" ? "Entered manually" : "Synced from the dashboard"}
                  {record.manualOverride ? " (manual override)" : ""}
                </span>
              )}
            </p>
          </div>
          <div className="day-details-header-actions">
            <DashboardLink date={day.date} />
            <button ref={closeRef} className="modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>

        {meta.noScheduledCleaning ? (
          <div className="day-status-banner paused" role="note">
            <strong>Scheduled cleaning paused · {pausedReason(meta)}</strong>
            {extraReason(meta) && <span>Reason: {extraReason(meta)}</span>}
            <span>
              {meta.pausedServiceApartments > 0
                ? `${meta.pausedServiceApartments} apartment${meta.pausedServiceApartments === 1 ? "" : "s"} had paused services.`
                : "No apartments were recorded with paused services."}
            </span>
          </div>
        ) : (
          badge && (
            <div className="day-status-banner info" role="note">
              <strong>{badge.text}</strong>
              <span>Scheduled cleaning was not paused on this day.</span>
            </div>
          )
        )}

        {day.anomaly?.flagged && (
          <section className="modal-section anomaly-section" role="alert">
            <h3>⚠ Unusual consumption</h3>
            <ul className="anomaly-list">
              {day.anomaly.reasons.map((r, i) => (
                <li key={i}>
                  <strong>{ANOMALY_TITLE[r.type] || "Alert"}:</strong> {r.message}
                  <AnomalyFigures r={r} />
                </li>
              ))}
            </ul>
            <p className="field-hint">
              Each product is measured on its own basis: per housekeeping room (or serviced room), per laundry room, per
              water apartment, or its daily total for fixed items. When a max is set, the day&apos;s rate (fixed: the day&apos;s
              total) is flagged above it; otherwise above 1.5× its average on this period&apos;s regular days (and more than
              2 units). Use on a
              Sunday, a holiday or a day with 0 of that service is flagged too. Products set to “None” are never flagged.
              Check the movements below for a wrong date, a wrong quantity or a double entry.
            </p>
          </section>
        )}

        <section className="modal-section">
          <h3>Occupancy and operations</h3>
          {!record && (
            <p className="field-hint">No occupancy record for this day yet. Sync from the dashboard or add it manually.</p>
          )}
          <dl className="day-facts">
            {rows.map((r) => (
              <div key={r.label} className="day-fact">
                <dt>{r.label}</dt>
                <dd>
                  <span className="day-fact-value">{r.value}</span>
                  <ApartmentList numbers={r.numbers} />
                </dd>
              </div>
            ))}
          </dl>
          {record?.note && <p className="field-hint">Note: {record.note}</p>}
        </section>

        <section className="modal-section">
          <h3>Warehouse stock out on this date</h3>
          {loading ? (
            <p className="loading-state">Loading stock outs...</p>
          ) : error ? (
            <p className="section-error">{error}</p>
          ) : details.stockOuts.length === 0 ? (
            <p className="empty-state">No stock-out movements recorded in the warehouse on this date.</p>
          ) : (
            <>
              <div className="table-wrapper">
                <table className="reports-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Product</th>
                      <th>Quantity</th>
                      <th>Unit</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.stockOuts.map((m) => (
                      <tr key={m.id}>
                        <td data-label="Time">{timeOf(m.date, details.timeZone)}</td>
                        <td data-label="Product">
                          {m.product}
                          {m.productArchived && <span className="archived-tag">archived</span>}
                        </td>
                        <td data-label="Quantity">
                          {m.quantity}
                          {m.corrected && (
                            <span
                              className="corrected-tag"
                              title={`Corrected from ${m.originalQuantity} ${m.originalUnit || ""}${m.correctionReason ? `: ${m.correctionReason}` : ""}`}
                            >
                              corrected
                            </span>
                          )}
                        </td>
                        <td data-label="Unit">{m.unit}</td>
                        <td data-label="Note">{m.note || "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="field-hint">
                {details.stockOuts.length} movement{details.stockOuts.length === 1 ? "" : "s"} · total{" "}
                {details.stockOutTotals.map((t) => `${t.quantity} ${t.unit}`).join(" · ")} (times in {details.timeZone})
              </p>
            </>
          )}
        </section>

        <div className="card-actions day-details-footer">
          <DashboardLink date={day.date} />
          <button className="history-btn" onClick={() => onEdit(day)}>
            {day.hasRecord ? "Edit day" : "Add day"}
          </button>
          <button className="link-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
