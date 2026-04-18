// src/pages/Reports.jsx
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { saveAs } from "file-saver";
import "./reports.css";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://the-suits-project.onrender.com";
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
});

export default function Reports({ refreshKey, enabled }) {
  // ====== States ======
  const [dailyStockOut, setDailyStockOut] = useState([]);
  const [weeklyStockOut, setWeeklyStockOut] = useState([]);
  const [dailyStockIn, setDailyStockIn] = useState([]);
  const [weeklyStockIn, setWeeklyStockIn] = useState([]);
  const [error, setError] = useState("");

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(false);

  // ====== Fetch Reports ======
  const fetchReports = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError("");
      const [dailyOutRes, weeklyOutRes, dailyInRes, weeklyInRes] =
        await Promise.all([
          api.get("/api/reports/stock-out/daily"),
          api.get("/api/reports/stock-out/weekly"),
          api.get("/api/reports/stock-in/daily"),
          api.get("/api/reports/stock-in/weekly"),
        ]);

      setDailyStockOut(dailyOutRes.data || []);
      setWeeklyStockOut(weeklyOutRes.data || []);
      setDailyStockIn(dailyInRes.data || []);
      setWeeklyStockIn(weeklyInRes.data || []);
    } catch (err) {
      console.error(err);
      setError("Failed to fetch reports");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports, refreshKey]);

  const formatDate = (date) => new Date(date).toLocaleDateString("en-GB");

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
      <h2 className="reports-section-title">Daily Stock Out</h2>
      <div className="table-wrapper">
        {loading ? (
          <p className="loading-state">Loading reports...</p>
        ) : (
          <table className="reports-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Product</th>
                <th>Quantity</th>
                <th>Unit</th>
                {/* <th>Floor</th>
                <th>Used By</th> */}
              </tr>
            </thead>
            <tbody>
              {dailyStockOut.map((item) => (
                <tr key={item._id}>
                  <td data-label="Date">{formatDate(item.date)}</td>
                  <td data-label="Product">{item.productName}</td>
                  <td data-label="Quantity">{item.quantity}</td>
                  <td data-label="Unit">{item.unit}</td>
                  {/* <td>{item.floor || "-"}</td>
                  <td>{item.usedBy || "-"}</td> */}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2 className="reports-section-title">Weekly Stock Out</h2>
      <div className="table-wrapper">
        <table className="reports-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Product</th>
              <th>Quantity</th>
              <th>Unit</th>
              {/* <th>Floor</th>
              <th>Used By</th> */}
            </tr>
          </thead>
          <tbody>
            {weeklyStockOut.map((item) => (
              <tr key={item._id}>
                <td data-label="Date">{formatDate(item.date)}</td>
                <td data-label="Product">{item.productName}</td>
                <td data-label="Quantity">{item.quantity}</td>
                <td data-label="Unit">{item.unit}</td>
                {/* <td>{item.floor || "-"}</td>
                <td>{item.usedBy || "-"}</td> */}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="reports-section-title">Daily Stock In</h2>
      <div className="table-wrapper">
        <table className="reports-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Product</th>
              <th>Quantity</th>
              <th>Unit</th>
              {/* <th>Source</th> */}
            </tr>
          </thead>
          <tbody>
            {dailyStockIn.map((item) => (
              <tr key={item._id}>
                <td data-label="Date">{formatDate(item.date)}</td>
                <td data-label="Product">{item.productName}</td>
                <td data-label="Quantity">{item.quantity}</td>
                <td data-label="Unit">{item.unit}</td>
                {/* <td>{item.source || "-"}</td> */}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="reports-section-title">Weekly Stock In</h2>
      <div className="table-wrapper">
        <table className="reports-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Product</th>
              <th>Quantity</th>
              <th>Unit</th>
              {/* <th>Source</th> */}
            </tr>
          </thead>
          <tbody>
            {weeklyStockIn.map((item) => (
              <tr key={item._id}>
                <td data-label="Date">{formatDate(item.date)}</td>
                <td data-label="Product">{item.productName}</td>
                <td data-label="Quantity">{item.quantity}</td>
                <td data-label="Unit">{item.unit}</td>
                {/* <td>{item.source || "-"}</td> */}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
