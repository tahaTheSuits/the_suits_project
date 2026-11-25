// src/components/reports.jsx
// Report data is loaded once by App (shared with the dashboard stats) and
// passed in per section, so each table loads and fails independently.
import { useState } from "react";
import { saveAs } from "file-saver";
import { api } from "../api.js";
import "./reports.css";

const SECTIONS = [
  { key: "dailyOut", title: "Daily Stock Out" },
  { key: "weeklyOut", title: "Weekly Stock Out" },
  { key: "dailyIn", title: "Daily Stock In" },
  { key: "weeklyIn", title: "Weekly Stock In" },
];

const formatDate = (date) => new Date(date).toLocaleDateString("en-GB");

function ReportTable({ title, section, onRetry, retrying }) {
  const { data, loading, error, loaded } = section;

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
                  <td data-label="Quantity">{item.quantity}</td>
                  <td data-label="Unit">{item.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

export default function Reports({ sections, onRetry, retrying }) {
  const [error, setError] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // ====== Export Functions ======
  const exportExcel = async (type, period) => {
    try {
      setError("");
      const url = `/api/export/${type}/excel?from=${fromDate}&to=${toDate}`;
      const res = await api.get(url, { responseType: "blob" });
      saveAs(res.data, `${type}-${period}-report.xlsx`);
    } catch (err) {
      console.error(err);
      setError("Excel export failed");
    }
  };

  const exportPDF = async (type, period) => {
    try {
      setError("");
      const url = `/api/export/${type}/pdf?from=${fromDate}&to=${toDate}`;
      const res = await api.get(url, { responseType: "blob" });
      saveAs(res.data, `${type}-${period}-report.pdf`);
    } catch (err) {
      console.error(err);
      setError("PDF export failed");
    }
  };

  return (
    <div className="reports-container">
      <h1 className="reports-title">Reports Dashboard</h1>
      {error && <p className="reports-error">{error}</p>}

      {/* Date Filters */}
      <div className="reports-filters">
        <label>
          From
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="reports-input"
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="reports-input"
          />
        </label>
      </div>

      {/* Export Buttons */}
      <div className="export-container">
        <div className="export-section">
          <span>Stock In</span>
          <button onClick={() => exportPDF("stock-in")}>Export PDF</button>
          <button onClick={() => exportExcel("stock-in")}>Export Excel</button>
        </div>
        <div className="export-section">
          <span>Stock Out</span>
          <button onClick={() => exportPDF("stock-out")}>Export PDF</button>
          <button onClick={() => exportExcel("stock-out")}>Export Excel</button>
        </div>
      </div>

      {SECTIONS.map(({ key, title }) => (
        <ReportTable
          key={key}
          title={title}
          section={sections[key]}
          onRetry={onRetry}
          retrying={retrying}
        />
      ))}
    </div>
  );
}
