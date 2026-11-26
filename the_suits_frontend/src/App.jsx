// src/App.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { setInventory, upsertInventoryItem } from "./features/inventory/inventorySlice.js";
import {
  api,
  UNITS,
  CONSUMPTION_BASES,
  NO_LIMIT_HELP,
  basisInfo,
  getErrorMessage,
  inferConsumptionBasis,
  isCanceled,
} from "./api.js";
import Reports from "./components/reports.jsx";
import ProductHistory from "./components/ProductHistory.jsx";
import LedgerCheck from "./components/LedgerCheck.jsx";
import { PeriodLockContext, isTodayLocked, lockMessage } from "./periodLock.js";
import StockOutCard from "./components/StockOutCard.jsx";
import PeriodLockControl from "./components/PeriodLockControl.jsx";
import WarehouseResetControl from "./components/WarehouseResetControl.jsx";
import { useToast } from "./toast.js";
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

// Product table filters. "Category" is the consumption basis (housekeeping,
// laundry, water, fixed, none): the product grouping the warehouse already has.
const STATUS_FILTERS = [
  { value: "active", label: "All active" },
  { value: "ok", label: "In stock" },
  { value: "low", label: "Low stock" },
  { value: "out", label: "Out of stock" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All (incl. archived)" },
];

const PANEL_TITLES = { add: "Add new product", in: "Stock in", out: "Stock out" };

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
  // Feedback goes to the toast stack (top-right), not an inline banner.
  const notify = useToast();

  const [inventoryState, setInventoryState] = useState(initialSection);
  const [reports, setReports] = useState(initialReports);
  const [submitting, setSubmitting] = useState("");

  // Stock in/out fields
  const [stockInProduct, setStockInProduct] = useState("");
  const [stockInQty, setStockInQty] = useState("");

  // New product
  const [newProductName, setNewProductName] = useState("");
  const [newProductQty, setNewProductQty] = useState("");
  const [newProductMinStock, setNewProductMinStock] = useState("");
  const [newProductBarcode, setNewProductBarcode] = useState("");
  const [newProductUnit, setNewProductUnit] = useState("pcs");
  const [newProductBasis, setNewProductBasis] = useState(""); // "" = auto from name
  const [newProductThreshold, setNewProductThreshold] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [categoryFilter, setCategoryFilter] = useState("");
  // Which action form is open under the toolbar: "add" | "in" | "out" | null.
  const [activePanel, setActivePanel] = useState(null);
  const [historyProductId, setHistoryProductId] = useState(null);
  // Bumped after every successful inventory load (i.e. after every save),
  // so reports that keep their own data (occupancy, period balance) refetch.
  const [dataVersion, setDataVersion] = useState(0);
  // Bumped by a full warehouse reset: report panels remount with empty state.
  const [resetVersion, setResetVersion] = useState(0);

  // Accounting period lock (GET/PATCH /api/settings/period-lock).
  const [periodLockData, setPeriodLockData] = useState({ lockedThroughDate: null, today: null, history: [] });
  const applyPeriodLock = useCallback((data) => {
    if (!data) return;
    setPeriodLockData((prev) => ({
      lockedThroughDate: data.lockedThroughDate ?? null,
      today: data.today || prev.today,
      history: Array.isArray(data.history) ? data.history : prev.history,
    }));
  }, []);
  const reloadPeriodLock = useCallback(async () => {
    try {
      const res = await api.get("/api/settings/period-lock");
      applyPeriodLock(res.data);
    } catch (err) {
      // Not fatal: the server still enforces the lock on every change.
      if (!isCanceled(err)) console.error("period lock:", err);
    }
  }, [applyPeriodLock]);
  const periodLock = useMemo(
    () => ({ ...periodLockData, reload: reloadPeriodLock, apply: applyPeriodLock }),
    [periodLockData, reloadPeriodLock, applyPeriodLock],
  );
  const todayLocked = isTodayLocked(periodLock);

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
    reloadPeriodLock();
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
      setDataVersion((v) => v + 1);
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
  }, [dispatch, reloadPeriodLock]);

  useEffect(() => {
    document.title = "The Suites Warehouse";
    loadData();
    return () => abortRef.current?.abort();
  }, [loadData]);

  const activeItems = useMemo(() => items.filter((item) => item.isActive !== false), [items]);

  // Consumption alerts depend on each product's rule: any change to a basis or
  // cap (including the immediate update after a save) changes this key.
  const rulesSignature = useMemo(
    () =>
      items
        .map((i) => `${i._id}:${i.consumptionBasis}:${i.consumptionBasisInferred ? 1 : 0}:${i.normalMaxThreshold ?? ""}`)
        .join("|"),
    [items],
  );
  const reportRefreshKey = `${dataVersion}#${rulesSignature}`;

  // Full warehouse reset succeeded: clear every view right away, then reload
  // from the (now empty) server to confirm.
  const handleWarehouseReset = useCallback(
    async (result) => {
      dispatch(setInventory([]));
      setReports(Object.fromEntries(REPORT_KEYS.map((key) => [key, { data: [], loading: false, error: "", loaded: true }])));
      setHistoryProductId(null);
      setStockInProduct("");
      setStockInQty("");
      setSearchTerm("");
      setStatusFilter("active");
      setCategoryFilter("");
      setActivePanel(null);
      applyPeriodLock({ lockedThroughDate: null, history: [] });
      setResetVersion((v) => v + 1);
      notify(result?.message || "All warehouse data was deleted.", "success");
      await loadData();
    },
    [dispatch, applyPeriodLock, loadData, notify],
  );

  // A saved product row from the server goes straight into shared state.
  const handleProductUpdated = useCallback((row) => dispatch(upsertInventoryItem(row)), [dispatch]);
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
      notify(successMessage, "success");
      return true;
    } catch (err) {
      console.error(err);
      notify(getErrorMessage(err, fallbackError), "error");
      return false;
    } finally {
      setSubmitting("");
    }
  };

  // Add Product
  const handleAddNewProduct = async () => {
    if (!newProductName.trim()) return notify("Enter a product name.", "warning");
    const ok = await runMutation(
      "add",
      () =>
        api.post("/api/products", {
          name: newProductName.trim(),
          // Empty -> server default (5)
          minStock: newProductMinStock === "" ? undefined : Number(newProductMinStock),
          // Optional; trimmed only, so leading zeros are kept.
          barcode: newProductBarcode.trim() || undefined,
          initialQty: Number(newProductQty) || 0,
          unit: newProductUnit,
          // Empty -> inferred from the name on the server.
          consumptionBasis: newProductBasis || undefined,
          normalMaxThreshold: newProductThreshold === "" ? undefined : Number(newProductThreshold),
        }),
      `Product "${newProductName.trim()}" added.`,
      "Failed to add product",
    );
    if (ok) {
      setNewProductName("");
      setNewProductMinStock("");
      setNewProductQty("");
      setNewProductBarcode("");
      setNewProductBasis("");
      setNewProductThreshold("");
    }
  };

  const stockInItem = activeItems.find((item) => item._id === stockInProduct);

  // Stock In — always recorded in the product's own unit
  const handleStockIn = async () => {
    if (!stockInItem || !stockInQty) return notify("Select a product and a quantity.", "warning");
    const ok = await runMutation(
      "in",
      () =>
        api.post("/api/stock-in", {
          product: stockInItem._id,
          quantity: Number(stockInQty),
          source: "Main Hotel",
          unit: stockInItem.unit,
        }),
      `Stock in: ${Number(stockInQty)} ${stockInItem?.unit || ""} of ${stockInItem?.product || "product"}.`,
      "Stock In failed",
    );
    if (ok) {
      setStockInProduct("");
      setStockInQty("");
    }
  };

  const handleArchiveProduct = async (item) => {
    if (!item?._id) return notify("No product ID.", "error");
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
    .filter((item) => {
      const archived = item.isActive === false;
      if (statusFilter === "all") return true;
      if (statusFilter === "archived") return archived;
      if (archived) return false;
      return statusFilter === "active" || item.status === statusFilter;
    })
    .filter((item) => !categoryFilter || item.consumptionBasis === categoryFilter)
    .filter((item) => {
      const term = searchTerm.trim().toLowerCase();
      return (
        item.product.toLowerCase().includes(term) ||
        (item.barcode && item.barcode.toLowerCase().includes(term))
      );
    })
    .sort((a, b) => {
      // Active before archived, out-of-stock items at the bottom of each group.
      const archived = Number(a.isActive === false) - Number(b.isActive === false);
      if (archived !== 0) return archived;
      return Number(a.status === "out") - Number(b.status === "out");
    });

  return (
    <PeriodLockContext.Provider value={periodLock}>
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <img className="topbar-logo" src={logo} alt="The Suites" />
          <div>
            <h1 className="topbar-title">Warehouse Management</h1>
            <p className="topbar-subtitle">Inventory control for housekeeping operations</p>
          </div>
        </div>
        <div className="topbar-actions">
          <PeriodLockControl />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => loadData()} disabled={isLoading}>
            <span aria-hidden="true">↻</span> {isLoading ? "Refreshing..." : "Refresh"}
          </button>
          <WarehouseResetControl onReset={handleWarehouseReset} />
        </div>
      </header>

      <main className="container">
        <section className="stats-grid" aria-label="Key figures">
          <article className="stat-card stat-total">
            <p className="stat-label">Total Products</p>
            <p className="stat-value">{stats.totalProducts}</p>
          </article>
          <article className="stat-card stat-low">
            <p className="stat-label">Low / Out of Stock</p>
            <p className="stat-value">{stats.lowStockItems}</p>
          </article>
          <article className="stat-card stat-in">
            <p className="stat-label">Stock In Today</p>
            <p className="stat-value">{stats.stockInToday}</p>
          </article>
          <article className="stat-card stat-out">
            <p className="stat-label">Stock Out Today</p>
            <p className="stat-value">{stats.stockOutToday}</p>
          </article>
        </section>

        <section className="panel products-panel">
          <div className="toolbar">
            <div className="toolbar-filters">
              <input
                className="input toolbar-search"
                type="search"
                placeholder="Search product or barcode..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                aria-label="Search products"
              />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status filter">
                {STATUS_FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                    {f.value === "archived" ? ` (${archivedCount})` : ""}
                  </option>
                ))}
              </select>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Category filter">
                <option value="">All categories</option>
                {CONSUMPTION_BASES.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="toolbar-actions">
              {["add", "in", "out"].map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`btn btn-sm ${key === "add" ? "btn-primary" : "btn-secondary"}${activePanel === key ? " is-active" : ""}`}
                  onClick={() => setActivePanel(activePanel === key ? null : key)}
                  aria-expanded={activePanel === key}
                >
                  {key === "add" ? "+ Add Product" : key === "in" ? "↓ Stock In" : "↑ Stock Out"}
                </button>
              ))}
            </div>
          </div>

          {activePanel && (
            <div className="action-panel" role="region" aria-label={PANEL_TITLES[activePanel]}>
              <div className="action-panel-head">
                <h2>{PANEL_TITLES[activePanel]}</h2>
                <button type="button" className="modal-close" onClick={() => setActivePanel(null)} aria-label="Close form">
                  ×
                </button>
              </div>
              {activePanel === "add" && (
        <div className="card">
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

            <input
              className="input"
              placeholder="Barcode (optional)"
              value={newProductBarcode}
              onChange={(e) => setNewProductBarcode(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />

            <select
              value={newProductBasis}
              onChange={(e) => setNewProductBasis(e.target.value)}
              aria-label="Consumption alert basis"
              title="What this product's daily use is compared with for consumption alerts"
            >
              <option value="">
                Alerts: auto ({basisInfo(inferConsumptionBasis(newProductName)).label})
              </option>
              {CONSUMPTION_BASES.map((b) => (
                <option key={b.value} value={b.value}>
                  Alerts: {b.label}
                </option>
              ))}
            </select>

            {(() => {
              const basis = basisInfo(newProductBasis || inferConsumptionBasis(newProductName));
              if (basis.value === "none") return null;
              return (
                <label className="limit-field">
                  <span>{basis.limitLabel} (optional)</span>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="any"
                    placeholder={basis.value === "fixed" ? "e.g. 10" : "e.g. 0.9"}
                    value={newProductThreshold}
                    onChange={(e) => setNewProductThreshold(e.target.value)}
                  />
                  <small>{basis.limitHelp} {NO_LIMIT_HELP}</small>
                </label>
              );
            })()}
          </div>
          {todayLocked && Number(newProductQty) > 0 && (
            <p className="lock-warning">🔒 {lockMessage(periodLock.lockedThroughDate)} An initial quantity would be a stock in dated today: leave it at 0.</p>
          )}
          <div className="card-actions">
            <button
              onClick={handleAddNewProduct}
              className="btn btn-primary"
              
              disabled={Boolean(submitting) || (todayLocked && Number(newProductQty) > 0)}
            >
              {submitting === "add" ? "Adding..." : "Add Product"}
            </button>
          </div>
        </div>

              )}
              {activePanel === "in" && (
        <div className="card">
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
          {todayLocked && <p className="lock-warning">🔒 {lockMessage(periodLock.lockedThroughDate)}</p>}
          <div className="card-actions">
            <button
              onClick={handleStockIn}
              className="btn btn-primary"
              
              disabled={Boolean(submitting) || todayLocked}
            >
              {submitting === "in" ? "Adding..." : "Add"}
            </button>
          </div>
        </div>

              )}
              {/* Stock Out — barcode scan or manual selection */}
              {activePanel === "out" && <StockOutCard activeItems={activeItems} onRecorded={loadData} notify={notify} />}
            </div>
          )}

          <div className="section-head">
            <h2 className="section-title">Products</h2>
            <span className="section-count">
              {visibleItems.length} shown · {activeItems.length} active{archivedCount ? ` · ${archivedCount} archived` : ""}
            </span>
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
                      <LedgerCheck
                        productId={item._id}
                        productName={item.product}
                        reconciliation={item.reconciliation}
                        onChanged={loadData}
                        compact
                      />
                      {item.barcode && <span className="barcode-tag">{item.barcode}</span>}
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

                    <td data-label="action" className="action-cell">
                      <button
                        className="history-btn"
                        onClick={() => setHistoryProductId(item._id)}
                        title="Movements, corrections and min stock"
                      >
                        History
                      </button>
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
        </section>

        {/* key: a warehouse reset remounts every report panel with empty state */}
        <Reports
        key={`reports-${resetVersion}`}
        sections={reports}
        stock={{
          items,
          loaded: inventoryState.loaded,
          loading: inventoryState.loading,
          error: inventoryState.error,
        }}
        products={activeItems}
        refreshKey={reportRefreshKey}
        resetVersion={resetVersion}
        onRetry={loadData}
        retrying={isLoading}
      />
      {historyProductId && (
        <ProductHistory
          productId={historyProductId}
          products={activeItems}
          onProductUpdated={handleProductUpdated}
          onClose={() => setHistoryProductId(null)}
          onChanged={loadData}
        />
      )}
      </main>
    </div>
    </PeriodLockContext.Provider>
  );
}

export default App;
