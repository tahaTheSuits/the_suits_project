// Consumption vs occupancy: daily occupancy / housekeeping records (synced
// from the admin dashboard or entered manually) combined with corrected stock
// out per product. Collapsed by default so it adds no requests on page load.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, basisInfo, downloadFile, getErrorMessage, rangeSlug } from "../api.js";
import { dayBadge } from "../dayStatus.js";
import DayDetailsModal, { DashboardLink } from "./DayDetailsModal.jsx";

const FIELDS = [
  { key: "totalApartments", label: "Total apartments" },
  { key: "occupiedApartments", label: "Occupied" },
  { key: "checkIns", label: "Check-ins" },
  { key: "checkOuts", label: "Check-outs" },
  { key: "servicedApartments", label: "Serviced apartments" },
  { key: "housekeepingCount", label: "Housekeeping tasks" },
  { key: "laundryCount", label: "Laundry" },
  { key: "waterCount", label: "Water" },
];

const METRICS = [
  { key: "perOccupiedApartment", label: "Per occupied apt" },
  { key: "perServicedApartment", label: "Per serviced apt" },
  { key: "perHousekeepingTask", label: "Per housekeeping task" },
];

const gb = (key) => key.split("-").reverse().join("/");
const dash = (v) => (v === null || v === undefined ? "–" : v);

function MetricCell({ metric, unit }) {
  if (!metric || metric.value === null) {
    return (
      <span className="metric-na" title={metric?.note || "No data"}>
        N/A <span className="muted">({metric?.note || "No data"})</span>
      </span>
    );
  }
  return (
    <span title={`${metric.numerator} ${unit} ÷ ${metric.denominator} over ${metric.daysWithData} day(s)`}>
      {metric.value} {unit}
      {metric.status === "partial" && (
        <span className="muted">
          {" "}
          ({metric.daysWithData}/{metric.totalDays} days)
        </span>
      )}
    </span>
  );
}

// Delay before a background refresh, so a burst of changes (save -> row
// update -> full reload) results in a single request.
const REFRESH_DELAY_MS = 250;

export default function OccupancyPanel({ refreshKey }) {
  const [open, setOpen] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState("");
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [forceSync, setForceSync] = useState(false);
  const [syncResult, setSyncResult] = useState(null); // { ok, message, details? }
  // Only the date is kept: the modal always gets the current report's row,
  // so a refreshed report (new rules / data) updates an open modal too.
  const [detailsDate, setDetailsDate] = useState(null);
  const setDetailsDay = useCallback((day) => setDetailsDate(day ? day.date : null), []);
  const closeDetails = useCallback(() => setDetailsDate(null), []);
  const detailsDay = detailsDate ? report?.days.find((d) => d.date === detailsDate) || null : null;

  const loadSeqRef = useRef(0);
  const lastRangeRef = useRef(null); // range of the report on screen

  const rangeInvalid = Boolean(fromDate && toDate && fromDate > toDate);
  const params = { from: fromDate || undefined, to: toDate || undefined };

  const load = useCallback(async (from, to) => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/api/reports/occupancy-consumption", {
        params: { from: from || undefined, to: to || undefined },
      });
      if (seq !== loadSeqRef.current) return; // a newer load is on its way
      setReport(res.data);
      lastRangeRef.current = { from: res.data.from, to: res.data.to };
    } catch (err) {
      if (seq === loadSeqRef.current) setError(getErrorMessage(err, "Failed to load the occupancy report"));
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, []);

  // Product rules or warehouse data changed elsewhere (e.g. a consumption
  // rule saved in History): refetch the report on screen for the same days.
  useEffect(() => {
    if (!refreshKey) return undefined;
    const timer = setTimeout(() => {
      const range = lastRangeRef.current;
      if (range) load(range.from, range.to);
    }, REFRESH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [refreshKey, load]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !report) load(fromDate, toDate);
  };

  const exportAs = async (format) => {
    if (rangeInvalid) return setError("The From date must be on or before the To date.");
    const ext = format === "pdf" ? "pdf" : "xlsx";
    const slug = fromDate || toDate ? rangeSlug(fromDate, toDate) : report?.slug || "last-7-days";
    setExporting(format);
    setError("");
    try {
      await downloadFile(`/api/export/occupancy-consumption/${format}`, `occupancy-consumption_${slug}.${ext}`, params);
    } catch (err) {
      setError(getErrorMessage(err, "Export failed"));
    } finally {
      setExporting("");
    }
  };

  // Pulls the selected period from the-suites-admin-dashboard via the API
  // (the API holds the dashboard URL and key). Only runs on click.
  const syncFromDashboard = async () => {
    if (rangeInvalid) return setError("The From date must be on or before the To date.");
    if (
      forceSync &&
      !window.confirm(
        "Overwrite days that were edited manually in the warehouse with the dashboard's values?",
      )
    ) {
      return;
    }
    setSyncing(true);
    setSyncResult(null);
    setError("");
    try {
      const res = await api.post(
        "/api/occupancy/pull-dashboard",
        { from: fromDate || undefined, to: toDate || undefined, force: forceSync },
        { timeout: 60000 },
      );
      const invalid = (res.data.results || []).filter((r) => r.status === "invalid");
      setSyncResult({
        ok: invalid.length === 0,
        message: res.data.message,
        details: invalid.map((r) => `${r.date ?? "?"}: ${r.message}`),
        skippedOverride: res.data.summary?.skipped_manual_override || 0,
      });
      await load(fromDate, toDate);
    } catch (err) {
      setSyncResult({ ok: false, message: getErrorMessage(err, "Sync from the dashboard failed") });
    } finally {
      setSyncing(false);
    }
  };

  const editDay = (day) => {
    setDetailsDay(null);
    setNotice("");
    setForm({
      date: day.date,
      ...Object.fromEntries(
        FIELDS.map((f) => [f.key, day[f.key] === null || day[f.key] === undefined ? "" : String(day[f.key])]),
      ),
      note: day.note || "",
      // A manual edit protects the day from being overwritten by the next sync
      // unless the user unticks it.
      manualOverride: true,
    });
  };

  const saveForm = async () => {
    if (!form.date) return setNotice("Choose a date.");
    setSaving(true);
    setNotice("");
    try {
      // Empty fields are sent as null (= unknown), never as 0.
      const body = {
        ...Object.fromEntries(FIELDS.map((f) => [f.key, form[f.key] === "" ? null : Number(form[f.key])])),
        note: form.note,
        manualOverride: form.manualOverride,
      };
      const res = await api.put(`/api/occupancy/${form.date}`, body);
      setNotice(res.data.message);
      setForm(null);
      await load(fromDate, toDate);
    } catch (err) {
      setNotice(getErrorMessage(err, "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  const s = report?.summary;

  return (
    <section className="occupancy-panel">
      <div className="current-stock-header">
        <h2 className="reports-section-title">Consumption vs Occupancy</h2>
        <button className="history-btn" onClick={toggle}>
          {open ? "Hide" : "Open"}
        </button>
      </div>

      {open && (
        <>
          <div className="reports-filters">
            <label>
              From
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="reports-input" />
            </label>
            <label>
              To
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="reports-input" />
            </label>
            <div className="current-stock-actions">
              <button onClick={() => load(fromDate, toDate)} disabled={loading || rangeInvalid}>
                {loading ? "Loading..." : "Load"}
              </button>
              <button onClick={() => exportAs("pdf")} disabled={Boolean(exporting) || rangeInvalid}>
                {exporting === "pdf" ? "Exporting..." : "Export PDF"}
              </button>
              <button onClick={() => exportAs("excel")} disabled={Boolean(exporting) || rangeInvalid}>
                {exporting === "excel" ? "Exporting..." : "Export Excel"}
              </button>
              <button onClick={() => editDay({ date: report?.to || "", hasRecord: false })}>Add / edit day</button>
              <button onClick={syncFromDashboard} disabled={syncing || rangeInvalid} title="Fetch this period from the admin dashboard">
                {syncing ? "Syncing..." : "Sync from Dashboard"}
              </button>
            </div>
          </div>
          <p className={`export-period${rangeInvalid ? " invalid" : ""}`}>
            {rangeInvalid
              ? "The From date must be on or before the To date."
              : "Leave dates empty for the last 7 days. Days follow the hotel's business day."}
          </p>

          <label className="inline-check sync-force">
            <input type="checkbox" checked={forceSync} onChange={(e) => setForceSync(e.target.checked)} />
            Also overwrite manually edited days when syncing
          </label>

          {syncResult && (
            <div className={`sync-result ${syncResult.ok ? "ok" : "error"}`} role="status">
              <span>{syncResult.message}</span>
              {syncResult.skippedOverride > 0 && !forceSync && (
                <span className="field-hint">
                  {" "}
                  Days you edited manually were kept; tick the box above to overwrite them.
                </span>
              )}
              {syncResult.details?.length > 0 && (
                <ul>
                  {syncResult.details.slice(0, 5).map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                  {syncResult.details.length > 5 && <li>…and {syncResult.details.length - 5} more</li>}
                </ul>
              )}
              <button className="link-btn" onClick={() => setSyncResult(null)}>
                Dismiss
              </button>
            </div>
          )}

          {error && <p className="reports-error">{error}</p>}
          {notice && <p className="modal-notice">{notice}</p>}

          {form && (
            <div className="correction-form occupancy-form">
              <p>
                <strong>Manual entry</strong> — empty fields mean “unknown”, not zero.
              </p>
              <div className="occupancy-grid">
                <label>
                  Date
                  <input
                    type="date"
                    className="input"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                  />
                </label>
                {FIELDS.map((f) => (
                  <label key={f.key}>
                    {f.label}
                    <input
                      type="number"
                      min="0"
                      step="1"
                      className="input"
                      value={form[f.key]}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    />
                  </label>
                ))}
                <label className="occupancy-note">
                  Note
                  <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                </label>
              </div>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={form.manualOverride}
                  onChange={(e) => setForm({ ...form, manualOverride: e.target.checked })}
                />
                Keep my values (dashboard sync will not overwrite this day)
              </label>
              <div className="card-actions">
                <button className="btn btn-primary" onClick={saveForm} disabled={saving}>
                  {saving ? "Saving..." : "Save day"}
                </button>
                <button className="link-btn" onClick={() => setForm(null)} disabled={saving}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {!report ? (
            <p className="loading-state">{loading ? "Loading..." : "No report loaded."}</p>
          ) : (
            <>
              <p className="current-stock-summary">
                {report.label} · occupancy data for {s.daysWithOccupancy}/{s.totalDays} days · occupied apartment-nights{" "}
                {dash(s.occupiedApartmentNights)} · serviced {dash(s.servicedApartments)} · housekeeping tasks{" "}
                {dash(s.housekeepingTasks)} · avg occupancy{" "}
                {s.averageOccupancyRate === null ? "N/A" : `${Math.round(s.averageOccupancyRate * 1000) / 10}%`}
                {s.anomalyDays > 0 && (
                  <span className="anomaly-summary">
                    {" "}
                    · ⚠ {s.anomalyDays} day{s.anomalyDays === 1 ? "" : "s"} with unusual consumption
                  </span>
                )}
              </p>

              <h3 className="occupancy-subtitle">Consumption by product</h3>
              <div className="table-wrapper">
                {report.products.length === 0 ? (
                  <p className="loading-state">No stock out in this period.</p>
                ) : (
                  <table className="reports-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Unit</th>
                        <th>Total out</th>
                        {METRICS.map((m) => (
                          <th key={m.key}>{m.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.products.map((p) => (
                        <tr key={p.productId}>
                          <td data-label="Product">
                            {p.product}
                            {p.archived && <span className="archived-tag">archived</span>}
                            {p.alertRule && (
                              <span
                                className={`basis-tag ${p.alertRule.basis}`}
                                title={
                                  p.alertRule.basis === "none"
                                    ? "No consumption alerts for this product"
                                    : `Alerts ${p.alertRule.basisLabel}${p.alertRule.normalMaxThreshold !== null ? `, normal max ${p.alertRule.normalMaxThreshold} ${p.unit}` : p.alertRule.average !== null ? `, period average ${p.alertRule.average} ${p.unit}` : ""}${p.alertRule.inferred ? " (basis set automatically from the name)" : ""}`
                                }
                              >
                                {basisInfo(p.alertRule.basis).label}
                                {p.alertRule.normalMaxThreshold !== null ? ` ≤ ${p.alertRule.normalMaxThreshold}` : ""}
                              </span>
                            )}
                            {p.unitConflicts > 0 && (
                              <span className="unit-warning">⚠ {p.unitConflicts} movement(s) in another unit</span>
                            )}
                          </td>
                          <td data-label="Unit">{p.unit}</td>
                          <td data-label="Total out">{p.totalOut}</td>
                          {METRICS.map((m) => (
                            <td key={m.key} data-label={m.label}>
                              <MetricCell metric={p[m.key]} unit={p.unit} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <p className="field-hint">
                Averages use only the days that have that data, e.g. per occupied apartment = stock out on days with
                occupancy ÷ occupied apartments on those days.
              </p>

              <h3 className="occupancy-subtitle">Daily occupancy and service</h3>
              <div className="table-wrapper">
                <table className="reports-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Occupied / total</th>
                      <th>Check-ins / outs</th>
                      <th>Serviced</th>
                      <th>Housekeeping</th>
                      <th>Laundry</th>
                      <th>Water</th>
                      <th>Source</th>
                      <th>Stock out</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.days.map((d) => {
                      const badge = dayBadge(d);
                      return (
                      <tr
                        key={d.date}
                        className={[d.hasRecord ? "" : "missing-row", d.anomaly?.flagged ? "anomaly-row" : ""].join(" ").trim() || undefined}
                      >
                        <td data-label="Date">
                          <span className="day-date">
                            {gb(d.date)}
                            {badge && (
                              <span className={`day-badge ${badge.kind}`} title={d.noServiceReason || badge.text}>
                                {badge.text}
                              </span>
                            )}
                          </span>
                        </td>
                        <td data-label="Occupied / total">
                          {d.hasRecord ? `${dash(d.occupiedApartments)} / ${dash(d.totalApartments)}` : "No data"}
                        </td>
                        <td data-label="Check-ins / outs">
                          {dash(d.checkIns)} / {dash(d.checkOuts)}
                        </td>
                        <td data-label="Serviced">{dash(d.servicedApartments)}</td>
                        <td data-label="Housekeeping">{dash(d.housekeepingCount)}</td>
                        <td data-label="Laundry">{dash(d.laundryCount)}</td>
                        <td data-label="Water">{dash(d.waterCount)}</td>
                        <td data-label="Source">
                          {!d.hasRecord ? "–" : d.source === "manual" ? "Manual" : "Sync"}
                          {d.manualOverride && <span className="corrected-tag">override</span>}
                        </td>
                        <td data-label="Stock out">
                          {d.stockOutByUnit.length ? d.stockOutByUnit.map((t) => `${t.quantity} ${t.unit}`).join(" · ") : "–"}
                          {d.anomaly?.flagged && (
                            <button
                              type="button"
                              className="anomaly-badge"
                              title={d.anomaly.reasons.map((r) => r.message).join("\n")}
                              onClick={() => setDetailsDay(d)}
                            >
                              ⚠ Unusual use
                            </button>
                          )}
                        </td>
                        <td data-label="" className="day-actions">
                          <button className="link-btn" onClick={() => setDetailsDay(d)}>
                            Details
                          </button>
                          <button className="link-btn" onClick={() => editDay(d)}>
                            {d.hasRecord ? "Edit" : "Add"}
                          </button>
                          <DashboardLink date={d.date} compact />
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
      {detailsDay && <DayDetailsModal key={detailsDay.date} day={detailsDay} onClose={closeDetails} onEdit={editDay} />}
    </section>
  );
}
