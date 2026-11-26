// Period stock balance for the selected report dates:
//   opening + stock in − stock out + adjustments = closing
// verified against the ledger at the end of the period. When the period
// reaches today, the closing balance is also compared with the stored stock
// (✓ Balanced / ⚠ Mismatch, with the reconciliation breakdown on click).
import { useState } from "react";
import { api, getErrorMessage } from "../api.js";
import LedgerCheck from "./LedgerCheck.jsx";

const signed = (n) => (n > 0 ? `+${n}` : String(n));

export default function PeriodBalance({ fromDate, toDate, rangeInvalid, periodLabel, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    if (rangeInvalid) return setError("The From date must be on or before the To date.");
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/api/reports/stock-balance", {
        params: { from: fromDate || undefined, to: toDate || undefined },
      });
      setData(res.data);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load the stock balance"));
    } finally {
      setLoading(false);
    }
  };

  const afterReconcile = async () => {
    await Promise.all([load(), onChanged?.()]);
  };

  return (
    <section className="period-balance">
      <div className="current-stock-header">
        <h2 className="reports-section-title">Stock balance for the period</h2>
        <div className="current-stock-actions">
          <button onClick={load} disabled={loading || rangeInvalid}>
            {loading ? "Checking..." : data ? "Refresh" : "Check balance"}
          </button>
        </div>
      </div>
      <p className="field-hint">
        Opening balance + stock in − stock out + adjustments = closing, for {periodLabel}. Uses the dates above.
      </p>
      {error && <p className="reports-error">{error}</p>}
      {data && (
        <>
          <p className="current-stock-summary">
            {data.label} · {data.summary.products} products ·{" "}
            <span className="status-pill ok">{data.summary.balanced} balanced</span>{" "}
            {data.summary.mismatched > 0 && <span className="status-pill low">{data.summary.mismatched} mismatched</span>}
            {!data.comparesStoredStock && <span className="muted"> · period ends before today: checked against the ledger only</span>}
          </p>
          <div className="table-wrapper">
            {data.rows.length === 0 ? (
              <p className="loading-state">No stock and no movements in this period.</p>
            ) : (
              <table className="reports-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Unit</th>
                    <th>Opening</th>
                    <th>In</th>
                    <th>Out</th>
                    <th>Adjustments</th>
                    <th>Closing</th>
                    <th>Check</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r._id} className={r.balanced ? undefined : "mismatch-row"}>
                      <td data-label="Product">
                        {r.product}
                        {!r.isActive && <span className="archived-tag">archived</span>}
                      </td>
                      <td data-label="Unit">{r.unit}</td>
                      <td data-label="Opening" className={r.opening < 0 ? "negative-qty" : undefined}>
                        {r.opening}
                      </td>
                      <td data-label="In">{r.periodIn}</td>
                      <td data-label="Out">{r.periodOut}</td>
                      <td data-label="Adjustments">{r.periodAdjusted ? signed(r.periodAdjusted) : "–"}</td>
                      <td data-label="Closing">{r.closing}</td>
                      <td data-label="Check">
                        {r.reconciliation ? (
                          <LedgerCheck
                            productId={r._id}
                            productName={r.product}
                            reconciliation={r.reconciliation}
                            onChanged={afterReconcile}
                            compact
                          />
                        ) : r.periodVerified ? (
                          <span className="ledger-badge balanced static" title="Opening + movements equals the ledger at the end of the period">
                            ✓ Verified
                          </span>
                        ) : (
                          <span className="ledger-badge mismatch static">⚠ Ledger {r.closingLedger}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </section>
  );
}
