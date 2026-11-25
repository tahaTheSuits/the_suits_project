// src/App.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { setInventory } from "./features/inventory/inventorySlice.js";
import { api, UNITS, getErrorMessage, isCanceled } from "./api.js";
import Reports from "./components/reports.jsx";
import logo from "./assets/logo2.png";
import "./App.css";

// Every endpoint is requested exactly once per load (the dashboard stats are
// derived from the daily reports instead of fetching them a second time).
const REPORT_ENDPOINTS = {
  dailyOut: "/api/reports/stock-out/daily",
  weeklyOut: "/api/reports/stock-out/weekly",
  dailyIn: "/api/reports/stock-in/daily",
  weeklyIn: "/api/reports/stock-in/weekly",
};
const REPORT_KEYS = Object.keys(REPORT_ENDPOINTS);

const initialSection = { data: [], loading: true, error: "", loaded: false };
const initialReports = () =>
  Object.fromEntries(REPORT_KEYS.map((key) => [key, initialSection]));

const STATUS_LABELS = {
  out: { label: "Out of Stock", className: "low" },
  low: { label: "Low Stock", className: "warn" },
  ok: { label: "In Stock", className: "ok" },
};

// "12 pcs · 3 gallon" — quantities in different units are never added together.
const formatTotalsByUnit = (rows) => {
  const totals = new Map();
  rows.forEach((row) => {
    const unit = row.unit || "pcs";
    totals.set(unit, (totals.get(unit) || 0) + (Number(row.quantity) || 0));
  });
  if (totals.size === 0) return "0";
  return [...totals.entries()].map(([unit, qty]) => `${qty} ${unit}`).join(" · ");
};

const describeConflicts = (conflicts) =>
  conflicts
    .map((c) => `${c.count} stock ${c.direction} (${c.quantity} ${c.unit})`)
    .join(", ");

function App() {
  const dispatch = useDispatch();
  const items = useSelector((state) => state.inventory.items || []);
  const [message, setMessage] = useState("");

  const [inventoryState, setInventoryState] = useState(initialSection);
  const [reports, setReports] = useState(initialReports);
  const [submitting, setSubmitting] = useState("");

  // Stock in/out fields
  const [stockInProduct, setStockInProduct] = useState("");
  const [stockInQty, setStockInQty] = useState("");
  const [stockOutProduct, setStockOutProduct] = useState("");
  const [stockOutQty, setStockOutQty] = useState("");

  // New product
  const [newProductName, setNewProductName] = useState("");
  const [newProductQty, setNewProductQty] = useState("");
  const [newProductMinStock, setNewProductMinStock] = useState("");
  const [newProductUnit, setNewProductUnit] = useState("pcs");

  const [searchTerm, setSearchTerm] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  // Only the latest load may write state; older/aborted responses are ignored.
  const loadSeqRef = useRef(0);
  const abortRef = useRef(null);

  const loadData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++loadSeqRef.current;

    setInventoryState((prev) => ({ ...prev, loading: true }));
    setReports((prev) =>
      Object.fromEntries(REPORT_KEYS.map((key) => [key, { ...prev[key], loading: true }])),
    );

    const config = { signal: controller.signal };
    const [inventoryResult, ...reportResults] = await Promise.allSettled([
      api.get("/api/inventory", { ...config, params: { includeArchived: true } }),
      ...REPORT_KEYS.map((key) => api.get(REPORT_ENDPOINTS[key], config)),
    ]);

    if (seq !== loadSeqRef.current) return;

    // Each section succeeds or fails on its own; a failure keeps the last
    // good data on screen and shows an error for that section only.
    if (inventoryResult.status === "fulfilled") {
      const data = inventoryResult.value.data;
      dispatch(setInventory(Array.isArray(data) ? data : []));
      setInventoryState({ data: [], loading: false, error: "", loaded: true });
    } else if (!isCanceled(inventoryResult.reason)) {
      console.error(inventoryResult.reason);
      setInventoryState((prev) => ({
        ...prev,
        loading: false,
        error: getErrorMessage(inventoryResult.reason, "Error fetching inventory"),
      }));
    }

    setReports((prev) => {
      const next = { ...prev };
      REPORT_KEYS.forEach((key, i) => {
        const result = reportResults[i];
        if (result.status === "fulfilled") {
          const data = result.value.data;
          next[key] = { data: Array.isArray(data) ? data : [], loading: false, error: "", loaded: true };
        } else if (!isCanceled(result.reason)) {
          console.error(result.reason);
          next[key] = {
            ...prev[key],
            loading: false,
            error: getErrorMessage(result.reason, "Failed to load this report"),
          };
        }
      });
      return next;
    });
  }, [dispatch]);

  useEffect(() => {
    document.title = "The Suites Warehouse";
    loadData();
    return () => abortRef.current?.abort();
  }, [loadData]);

  const activeItems = useMemo(() => items.filter((item) => item.isActive !== false), [items]);
  const archivedCount = items.length - activeItems.length;

  const stats = useMemo(() => {
    const daily = (section) =>
      section.loaded ? formatTotalsByUnit(section.data) : section.error ? "—" : "…";
    return {
      totalProducts: activeItems.length,
      lowStockItems: activeItems.filter((item) => item.status === "low" || item.status === "out").length,
      stockInToday: daily(reports.dailyIn),
      stockOutToday: daily(reports.dailyOut),
    };
  }, [activeItems, reports.dailyIn, reports.dailyOut]);

  const isLoading = inventoryState.loading || REPORT_KEYS.some((key) => reports[key].loading);

  const runMutation = async (key, request, successMessage, fallbackError) => {
    if (submitting) return false;
    setSubmitting(key);
    try {
      await request();
      await loadData();
      setMessage(successMessage);
      return true;
    } catch (err) {
      console.error(err);
      setMessage(getErrorMessage(err, fallbackError));
      return false;
    } finally {
      setSubmitting("");
    }
  };

  // Add Product
  const handleAddNewProduct = async () => {
    if (!newProductName.trim()) return setMessage("Enter product name");
    const ok = await runMutation(
      "add",
      () =>
        api.post("/api/products", {
          name: newProductName.trim(),
          // Empty -> server default (5)
          minStock: newProductMinStock === "" ? undefined : Number(newProductMinStock),
          initialQty: Number(newProductQty) || 0,
          unit: newProductUnit,
        }),
      "Product added successfully!",
      "Failed to add product",
    );
    if (ok) {
      setNewProductName("");
      setNewProductMinStock("");
      setNewProductQty("");
    }
  };

  const stockInItem = activeItems.find((item) => item._id === stockInProduct);
  const stockOutItem = activeItems.find((item) => item._id === stockOutProduct);

  // Stock In — always recorded in the product's own unit
  const handleStockIn = async () => {
    if (!stockInItem || !stockInQty) return setMessage("Select product & quantity");
    const ok = await runMutation(
      "in",
      () =>
        api.post("/api/stock-in", {
          product: stockInItem._id,
          quantity: Number(stockInQty),
          source: "Main Hotel",
          unit: stockInItem.unit,
        }),
      "Stock In successful!",
      "Stock In failed",
    );
    if (ok) {
      setStockInProduct("");
      setStockInQty("");
    }
  };

  // Stock Out — always recorded in the product's own unit
  const handleStockOut = async () => {
    if (!stockOutItem || !stockOutQty) return setMessage("Fill all Stock Out fields");
    const ok = await runMutation(
      "out",
      () =>
        api.post("/api/stock-out", {
          productId: stockOutItem._id,
          quantity: Number(stockOutQty),
          unit: stockOutItem.unit,
        }),
      "Stock Out successful!",
      "Stock Out failed",
    );
    if (ok) {
      setStockOutProduct("");
      setStockOutQty("");
    }
  };

  const handleArchiveProduct = async (item) => {
    if (!item?._id) return setMessage("No product ID");
    const confirmed = window.confirm(
      `Archive "${item.product}"?\n\n` +
        "It will be hidden from the inventory and the Stock In / Stock Out lists. " +
        "Its past movements stay in all reports, and you can restore it later.",
    );
    if (!confirmed) return;
    await runMutation(
      `archive:${item._id}`,
      () => api.patch(`/api/products/${item._id}/archive`),
      `"${item.product}" archived. Its history is kept.`,
      "Archive failed",
    );
  };

  const handleRestoreProduct = async (item) => {
    await runMutation(
      `restore:${item._id}`,
      () => api.patch(`/api/products/${item._id}/restore`),
      `"${item.product}" restored.`,
      "Restore failed",
    );
  };

  const visibleItems = items
    .filter((item) => showArchived || item.isActive !== false)
    .filter((item) => item.product.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => {
      // Active before archived, out-of-stock items at the bottom of each group.
      const archived = Number(a.isActive === false) - Number(b.isActive === false);
      if (archived !== 0) return archived;
      return Number(a.status === "out") - Number(b.status === "out");
    });

  return (
    <div className="container">
      <header className="app-header">
        <img className="logo" src={logo} alt="The Suites logo" />
      </header>

      {message && <p className="error-msg">{message}</p>}

      <section className="page-hero">
        <h1 className="title">The Suites Warehouse Dashboard</h1>
        <p className="subtitle">Inventory control for housekeeping operations</p>
      </section>

      <button
        onClick={() => loadData()}
        className="btn btn-primary refresh-btn"
        disabled={isLoading}
      >
        {isLoading ? "Refreshing..." : "Refresh Data"}
      </button>

      <section className="stats-grid">
        <article className="stat-card stat-total">
          <p className="stat-label">Total Products</p>
          <h3 className="stat-value">{stats.totalProducts}</h3>
        </article>
        <article className="stat-card stat-low">
          <p className="stat-label">Low / Out of Stock</p>
          <h3 className="stat-value">{stats.lowStockItems}</h3>
        </article>
        <article className="stat-card stat-in">
          <p className="stat-label">Stock In Today</p>
          <h3 className="stat-value">{stats.stockInToday}</h3>
        </article>
        <article className="stat-card stat-out">
          <p className="stat-label">Stock Out Today</p>
          <h3 className="stat-value">{stats.stockOutToday}</h3>
        </article>
      </section>

      <div className="cards-container">
        <div className="card">
          <h2>Add New Product</h2>
          <div className="from-row">
            <input
              className="input"
              placeholder="Product Name"
              value={newProductName}
              onChange={(e) => setNewProductName(e.target.value)}
            />

            <input
              className="input"
              type="number"
              min="0"
              placeholder="Initial Qty"
              value={newProductQty}
              onChange={(e) => setNewProductQty(e.target.value)}
            />

            <select
              value={newProductUnit}
              onChange={(e) => setNewProductUnit(e.target.value)}
              aria-label="Unit"
            >
              {UNITS.map((unit) => (
                <option key={unit} value={unit}>{unit}</option>
              ))}
            </select>

            <input
              className="input"
              type="number"
              min="0"
              placeholder="Min Stock (default 5)"
              value={newProductMinStock}
              onChange={(e) => setNewProductMinStock(e.target.value)}
            />
          </div>
          <div className="card-actions">
            <button
              onClick={handleAddNewProduct}
              className="btn btn-primary"
              style={{ width: "140px" }}
              disabled={Boolean(submitting)}
            >
              {submitting === "add" ? "Adding..." : "Add Product"}
            </button>
          </div>
        </div>

        {/* Stock In */}
        <div className="card">
          <h2>Stock In</h2>
          <div className="from-row">
            <select
              value={stockInProduct}
              onChange={(e) => setStockInProduct(e.target.value)}
            >
              <option value="">Select Product</option>
              {activeItems.map((item) => (
                <option key={item._id} value={item._id}>
                  {item.product} ({item.unit})
                </option>
              ))}
            </select>

            <input
              className="input"
              type="number"
              min="1"
              placeholder="Quantity"
              value={stockInQty}
              onChange={(e) => setStockInQty(e.target.value)}
            />

            <span className="unit-tag" title="Movements are recorded in the product's unit">
              {stockInItem ? stockInItem.unit : "unit"}
            </span>
          </div>
          <div className="card-actions">
            <button
              onClick={handleStockIn}
              className="btn btn-primary"
              style={{ width: "100px" }}
              disabled={Boolean(submitting)}
            >
              {submitting === "in" ? "Adding..." : "Add"}
            </button>
          </div>
        </div>

        {/* Stock Out */}
        <div className="card">
          <h2>Stock Out</h2>
          <div className="from-row">
            <select
              value={stockOutProduct}
              onChange={(e) => setStockOutProduct(e.target.value)}
            >
              <option value="">Select Product</option>
              {activeItems.map((item) => (
                <option key={item._id} value={item._id}>
                  {item.product} ({item.unit})
                </option>
              ))}
            </select>

            <input
              className="input"
              type="number"
              min="1"
              placeholder="Quantity"
              value={stockOutQty}
              onChange={(e) => setStockOutQty(e.target.value)}
            />

            <span className="unit-tag" title="Movements are recorded in the product's unit">
              {stockOutItem ? stockOutItem.unit : "unit"}
            </span>
          </div>
          {stockOutItem && (
            <p className="field-hint">
              Available: {stockOutItem.quantity} {stockOutItem.unit}
            </p>
          )}
          <div className="card-actions">
            <button
              onClick={handleStockOut}
              className="btn btn-danger"
              style={{ width: "110px" }}
              disabled={Boolean(submitting)}
            >
              {submitting === "out" ? "Saving..." : "Remove"}
            </button>
          </div>
        </div>

        {/* Search Inventory */}
        <div className="card search-card">
          <h2>Search Inventory 🔍</h2>
          <div className="from-row">
            <input
              className="input search-input"
              placeholder="Search product..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="card-actions card-note">
            <span>Quickly find items by product name.</span>
          </div>
        </div>
      </div>

      <div className="inventory-header">
        <h2 className="inventory-title">Current Inventory</h2>
        <label className="archived-toggle">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived ({archivedCount})
        </label>
      </div>

      {inventoryState.error && (
        <p className="section-error">
          {inventoryState.error}
          {inventoryState.loaded && " — showing the last loaded data."}{" "}
          <button className="link-btn" onClick={() => loadData()} disabled={isLoading}>
            Retry
          </button>
        </p>
      )}

      <div className="inventory-table-wrapper">
        {!inventoryState.loaded ? (
          <p className="loading-state">
            {inventoryState.loading ? "Loading inventory..." : "Inventory is unavailable."}
          </p>
        ) : (
          <table className="inventory-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Quantity</th>
                <th>Unit</th>
                <th>Min</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {visibleItems.map((item) => {
                const archived = item.isActive === false;
                const status = STATUS_LABELS[item.status] || STATUS_LABELS.ok;
                const busy = submitting === `archive:${item._id}` || submitting === `restore:${item._id}`;

                return (
                  <tr key={item._id} className={archived ? "archived-row" : undefined}>
                    <td data-label="product">
                      {item.product}
                      {item.unitConflicts?.length > 0 && (
                        <span
                          className="unit-warning"
                          title="These movements were recorded in a different unit than the product. They are included in the quantity — please review them."
                        >
                          ⚠ other units: {describeConflicts(item.unitConflicts)}
                        </span>
                      )}
                    </td>
                    <td data-label="quantity">{item.quantity}</td>
                    <td data-label="unit">{item.unit}</td>
                    <td data-label="min">
                      {item.minStock}
                      {item.minStockIsDefault && <span className="muted"> (default)</span>}
                    </td>

                    <td data-label="status">
                      {archived ? (
                        <span className="status-pill archived">Archived</span>
                      ) : (
                        <span className={`status-pill ${status.className}`}>{status.label}</span>
                      )}
                    </td>

                    <td data-label="action">
                      {archived ? (
                        <button
                          className="restore-btn"
                          onClick={() => handleRestoreProduct(item)}
                          disabled={Boolean(submitting)}
                        >
                          {busy ? "Restoring..." : "Restore"}
                        </button>
                      ) : (
                        <button
                          className="delete-btn"
                          onClick={() => handleArchiveProduct(item)}
                          disabled={Boolean(submitting)}
                        >
                          {busy ? "Archiving..." : "Archive"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <Reports sections={reports} onRetry={loadData} retrying={isLoading} />
    </div>
  );
}

export default App;
