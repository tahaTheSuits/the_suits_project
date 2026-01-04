// src/pages/Reports.jsx
import { useEffect, useState } from "react";
import axios from "axios";
import { saveAs } from "file-saver";
import "./reports.css";
import { FaFileExcel, FaFilePdf } from "react-icons/fa";

export default function Reports() {
  // ====== States ======
  const [dailyStockOut, setDailyStockOut] = useState([]);
  const [weeklyStockOut, setWeeklyStockOut] = useState([]);
  const [dailyStockIn, setDailyStockIn] = useState([]);
  const [weeklyStockIn, setWeeklyStockIn] = useState([]);
  const [error, setError] = useState("");

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(true);

  // ====== Fetch Reports ======
  const fetchReports = async () => {
    try {
      setLoading(true);
      setError("");
      const [dailyOutRes, weeklyOutRes, dailyInRes, weeklyInRes] =
        await Promise.all([
          axios.get(
            "https://the-suits-project.onrender.com/api/reports/stock-out/daily"
          ),
          axios.get(
            "https://the-suits-project.onrender.com/api/reports/stock-out/weekly"
          ),
          axios.get(
            "https://the-suits-project.onrender.com/api/reports/stock-in/daily"
          ),
          axios.get(
            "https://the-suits-project.onrender.com/api/reports/stock-in/weekly"
          ),
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
  };

  useEffect(() => {
    fetchReports();
    //// eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatDate = (date) => new Date(date).toLocaleDateString("en-GB");

  // ====== Export Functions ======
  const exportExcel = async (type, period) => {
    try {
      setError("");
      const url = `https://the-suits-project.onrender.com/api/export/${type}/excel?from=${fromDate}&to=${toDate}`;
      const res = await axios.get(url, { responseType: "blob" });
      saveAs(res.data, `${type}-${period}-report.xlsx`);
    } catch (err) {
      console.error(err);
      setError("Excel export failed");
    }
  };

  const exportPDF = async (type, period) => {
    try {
      setError("");
      const url = `https://the-suits-project.onrender.com/api/export/${type}/pdf?from=${fromDate}&to=${toDate}`;
      const res = await axios.get(url, { responseType: "blob" });
      saveAs(res.data, `${type}-${period}-report.pdf`);
    } catch (err) {
      console.error(err);
      setError("PDF export failed");
    }
  };

  return (
    <div className="reports-container">
      <h1 className="reports-title">📊 Reports Dashboard</h1>
      {error && <p className="reports-error">{error}</p>}

      {/* Date Filters */}
      <div className="reports-filters">
        <label>
          From:{" "}
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="reports-input"
          />
        </label>
        <label>
          To:{" "}
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
        <div className="export-wrapper">
          <button className="export-btn">Export ▼</button>

          <div className="export-menu">
            <div className="export-section">
              <span>Stock In:</span>
              <button onClick={() => exportPDF("stock-in")}>PDF</button>
              <button onClick={() => exportExcel("stock-in")}>Excel</button>
            </div>
            <div className="export-section">
              <span>Stock Out:</span>
              <button onClick={() => exportPDF("stock-out")}>PDF</button>
              <button onClick={() => exportExcel("stock-out")}>Excel</button>
            </div>
          </div>
        </div>
      </div>
      {/* Tables */}
      <h2 className="reports-section-title">Daily Stock Out:</h2>
      <div className="table-wrapper">
        {loading ? (
          <p
            style={{
              textAlign: "center",
              padding: "20px",
              fontSize: "30px",
              color: "red",
            }}
          >
            Loading inventory...
          </p>
        ) : (
          <table className="reports-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Product</th>
                <th>Quantity</th>
                <th>Unit</th>
                <th>Floor</th>
                <th>Used By</th>
              </tr>
            </thead>
            <tbody>
              {dailyStockOut.map((item) => (
                <tr key={item._id}>
                  <td>{formatDate(item.date)}</td>
                  <td>{item.productName}</td>
                  <td>{item.quantity}</td>
                  <td>{item.unit}</td>
                  <td>{item.floor || "-"}</td>
                  <td>{item.usedBy || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2 className="reports-section-title">Weekly Stock Out:</h2>
      <div className="table-wrapper">
        <table className="reports-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Product</th>
              <th>Quantity</th>
              <th>Unit</th>
              <th>Floor</th>
              <th>Used By</th>
            </tr>
          </thead>
          <tbody>
            {weeklyStockOut.map((item) => (
              <tr key={item._id}>
                <td>{formatDate(item.date)}</td>
                <td>{item.productName}</td>
                <td>{item.quantity}</td>
                <td>{item.unit}</td>
                <td>{item.floor || "-"}</td>
                <td>{item.usedBy || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="reports-section-title">Daily Stock In:</h2>
      <div className="table-wrapper">
        <table className="reports-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Product</th>
              <th>Quantity</th>
              <th>Unit</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {dailyStockIn.map((item) => (
              <tr key={item._id}>
                <td>{formatDate(item.date)}</td>
                <td>{item.productName}</td>
                <td>{item.quantity}</td>
                <td>{item.unit}</td>
                <td>{item.source || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="reports-section-title">Weekly Stock In:</h2>
      <div className="table-wrapper">
        <table className="reports-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Product</th>
              <th>Quantity</th>
              <th>Unit</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {weeklyStockIn.map((item) => (
              <tr key={item._id}>
                <td>{formatDate(item.date)}</td>
                <td>{item.productName}</td>
                <td>{item.quantity}</td>
                <td>{item.unit}</td>
                <td>{item.source || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
