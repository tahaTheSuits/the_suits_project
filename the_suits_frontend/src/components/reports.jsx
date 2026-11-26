// src/components/reports.jsx
// Quantities are effective (corrected) values; corrected rows are tagged.
// Report data is loaded once by App (shared with the dashboard stats) and
// passed in per section, so each table loads and fails independently.
import { useState } from "react";
import { useToast } from "../toast.js";
import { downloadFile, getErrorMessage, rangeSlug } from "../api.js";
import CurrentStockReport from "./CurrentStockReport.jsx";
import OccupancyPanel from "./OccupancyPanel.jsx";
import MovementEditModal from "./MovementEditModal.jsx";
import PeriodBalance from "./PeriodBalance.jsx";
import { isLockedDate, usePeriodLock } from "../periodLock.js";
import "./reports.css";

const SECTIONS = [
  { key: "dailyOut", title: "Daily Stock Out", type: "out" },
  { key: "weeklyOut", title: "Weekly Stock Out", type: "out" },
  { key: "dailyIn", title: "Daily Stock In", type: "in" },
  { key: "weeklyIn", title: "Weekly Stock In", type: "in" },
];

const formatDate = (date) => new Date(date).toLocaleDateString("en-GB");

const TABS = [
  { key: "balance", label: "Stock Balance & Reconciliation" },
  { key: "occupancy", label: "Occupancy & Consumption Alerts" },
  { key: "reports", label: "Reports & Exports" },
];

function ReportTable({ title, type, section, onRetry, retrying, onEdit }) {
  const { data, loading, error, loaded } = section;
  const lock = usePeriodLock();

  return (
    <>
      <h2 className="reports-section-title">{title}</h2>
      {error && (
        <p className="reports-error">
          {error}
          {loaded && " — showing the last loaded data."}{" "}
          <button className="link-btn" onClick={onRetry} disabled={retrying}>
            Retry
          </button>
        </p>
      )}
      <div className="table-wrapper">
        {!loaded ? (
          <p className="loading-state">{loading ? "Loading report..." : "Report unavailable."}</p>
        ) : data.length === 0 ? (
          <p className="loading-state">No movements in this period.</p>
        ) : (
          <table className="reports-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Product</th>
                <th>Quantity</th>
                <th>Unit</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((item) => (
                <tr key={item._id}>
                  <td data-label="Date">{formatDate(item.date)}</td>
                  <td data-label="Product">
                    {item.productName || "Unknown product"}
                    {item.productArchived && <span className="archived-tag">archived</span>}
                  </td>
                  <td data-label="Quantity">
                    {item.quantity}
                    {item.corrected && (
                      <span
                        className="corrected-tag"
                        title={`Recorded as ${item.originalQuantity} ${item.originalUnit || ""}${
                          item.correctionReason ? ` — ${item.correctionReason}` : ""
                        }`}
                      >
                        corrected
                      </span>
                    )}
                  </td>
                  <td data-label="Unit">{item.unit}</td>
                  <td data-label="">
                    {item.editedAt && <span className="corrected-tag" title="This entry was edited">edited</span>}
                    {isLockedDate(item.date, lock.lockedThroughDate) ? (
                      <span className="lock-badge" title={`Locked: the period is closed through ${lock.lockedThroughDate}`}>
                        🔒 locked
                      </span>
                    ) : item.product && (
                      <button className="link-btn" onClick={() => onEdit(type, item)}>
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

export default function Reports({ sections, stock, products = [], refreshKey, onRetry, retrying }) {
  const notify = useToast();
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  // Panels stay mounted when another tab is shown (hidden), so loaded data
  // and form state survive tab switches.
  const [tab, setTab] = useState("balance");

  const startEdit = (type, item) => {
    setEditing({
      _id: item._id,
      movementType: type,
      productId: item.product,
      productName: item.productName,
      quantity: item.quantity,
      unit: item.unit,
      date: item.date,
      note: item.note,
      source: item.source,
    });
  };
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [exporting, setExporting] = useState("");

  const formatInputDate = (value) => (value ? value.split("-").reverse().join("/") : "");
  const periodLabel =
    fromDate && toDate
      ? `${formatInputDate(fromDate)} – ${formatInputDate(toDate)}`
      : fromDate
        ? `${formatInputDate(fromDate)} – today`
        : toDate
          ? `up to ${formatInputDate(toDate)}`
          : "all dates";
  const rangeInvalid = Boolean(fromDate && toDate && fromDate > toDate);

  // ====== Export ======
  // type: "stock-in" | "stock-out", format: "pdf" | "excel".
  // Empty dates are allowed (all dates / open-ended); the server names the
  // file, e.g. stock-in-report_2026-11-01_to_2026-11-25.pdf.
  const exportReport = async (type, format) => {
    if (rangeInvalid) return setError("The From date must be on or before the To date.");
    const label = `${type === "stock-in" ? "Stock In" : "Stock Out"} ${format === "pdf" ? "PDF" : "Excel"}`;
    const ext = format === "pdf" ? "pdf" : "xlsx";
    setError("");
    setExporting(`${type}:${format}`);
    try {
      await downloadFile(`/api/export/${type}/${format}`, `${type}-report_${rangeSlug(fromDate, toDate)}.${ext}`, {
        from: fromDate || undefined,
        to: toDate || undefined,
      });
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err, `${label} export failed`));
    } finally {
      setExporting("");
    }
  };

  const exportButton = (type, format) => (
    <button onClick={() => exportReport(type, format)} disabled={Boolean(exporting) || rangeInvalid}>
      {exporting === `${type}:${format}` ? "Exporting..." : `Export ${format === "pdf" ? "PDF" : "Excel"}`}
    </button>
  );

  return (
    <section className="workspace" aria-label="Reports and analysis">
      <div className="workspace-head">
        <div className="tabs" role="tablist" aria-label="Report sections">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls={`tabpanel-${t.key}`}
              className={`tab${tab === t.key ? " active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab !== "occupancy" && (
          <div className="period-bar">
            <label>
              From
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="reports-input" />
            </label>
            <label>
              To
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="reports-input" />
            </label>
            <span className={`export-period${rangeInvalid ? " invalid" : ""}`}>
              {rangeInvalid ? "The From date must be on or before the To date." : `Period: ${periodLabel}`}
            </span>
          </div>
        )}
      </div>

      {error && <p className="reports-error">{error}</p>}

      <div className="tab-panel" role="tabpanel" id="tabpanel-balance" aria-labelledby="tab-balance" hidden={tab !== "balance"}>
        <CurrentStockReport {...stock} onRetry={onRetry} />
        <PeriodBalance
          refreshKey={refreshKey}
          fromDate={fromDate}
          toDate={toDate}
          rangeInvalid={rangeInvalid}
          periodLabel={periodLabel}
          onChanged={onRetry}
        />
      </div>

      <div className="tab-panel" role="tabpanel" id="tabpanel-occupancy" aria-labelledby="tab-occupancy" hidden={tab !== "occupancy"}>
        <OccupancyPanel refreshKey={refreshKey} embedded active={tab === "occupancy"} />
      </div>

      <div className="tab-panel" role="tabpanel" id="tabpanel-reports" aria-labelledby="tab-reports" hidden={tab !== "reports"}>
        <div className="export-container">
          <div className="export-section">
            <span>Stock In</span>
            {exportButton("stock-in", "pdf")}
            {exportButton("stock-in", "excel")}
          </div>
          <div className="export-section">
            <span>Stock Out</span>
            {exportButton("stock-out", "pdf")}
            {exportButton("stock-out", "excel")}
          </div>
        </div>
        <p className="field-hint">Exports cover {periodLabel}. Leave both dates empty to export everything.</p>

        {SECTIONS.map(({ key, title, type }) => (
          <ReportTable
            key={key}
            title={title}
            type={type}
            section={sections[key]}
            onRetry={onRetry}
            retrying={retrying}
            onEdit={startEdit}
          />
        ))}
      </div>

      {editing && (
        <MovementEditModal
          movement={editing}
          products={products}
          onClose={() => setEditing(null)}
          onSaved={async (result) => {
            notify(`${result?.message || "Entry updated."} Stock and reports were refreshed.`, "success");
            await onRetry();
          }}
        />
      )}
    </section>
  );
}
