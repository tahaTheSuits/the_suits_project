// src/App.jsx
import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { setInventory } from "./features/inventory/inventorySlice.js";
import axios from "axios";
import Reports from "./components/reports.jsx";
import logo from "./assets/logo2.png";
import "./App.css";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://the-suits-project.onrender.com";
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
});

function App() {
  const dispatch = useDispatch();
  const items = useSelector((state) => state.inventory.items || []);
  const [message, setMessage] = useState("");
  const [reportsRefreshKey, setReportsRefreshKey] = useState(0);
  const [stats, setStats] = useState({
    totalProducts: 0,
    lowStockItems: 0,
    stockInToday: 0,
    stockOutToday: 0,
  });

  const [stockOutUnit, setStockOutUnit] = useState("pcs");
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [reportsReady, setReportsReady] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Stock in/out fields
  const [stockInProduct, setStockInProduct] = useState("");
  const [stockInQty, setStockInQty] = useState("");
  const [stockOutProduct, setStockOutProduct] = useState("");
  const [stockOutQty, setStockOutQty] = useState("");
  // const [usedBy, setUsedBy] = useState("");
  // const [floor, setFloor] = useState("");

  // New product
  const [newProductName, setNewProductName] = useState("");
  const [newProductQty, setNewProductQty] = useState("");
  const [newProductMinStock, setNewProductMinStock] = useState("");

  const [searchTerm, setSearchTerm] = useState("");

  const [newProductUnit, setNewProductUnit] = useState("pcs");
  const [stockInUnit, setStockInUnit] = useState("pcs");

  // Fetch Inventory
  const fetchInventory = async () => {
    try {
      setInventoryLoading(true);
      const res = await api.get("/api/inventory");
      dispatch(setInventory(res.data || []));
    } catch (err) {
      console.error(err);
      setMessage("Error fetching inventory");
    } finally {
      setInventoryLoading(false);
    }
  };

  const fetchDashboardStats = async () => {
    try {
      const [stockInDailyRes, stockOutDailyRes] = await Promise.all([
        api.get("/api/reports/stock-in/daily"),
        api.get("/api/reports/stock-out/daily"),
      ]);

      const stockInToday = (stockInDailyRes.data || []).reduce(
        (sum, entry) => sum + (Number(entry.quantity) || 0),
        0,
      );
      const stockOutToday = (stockOutDailyRes.data || []).reduce(
        (sum, entry) => sum + (Number(entry.quantity) || 0),
        0,
      );

      setStats((prev) => ({
        ...prev,
        stockInToday,
        stockOutToday,
      }));
    } catch (err) {
      console.error(err);
    }
  };

  const refreshAll = async ({ prioritizeInventory = false } = {}) => {
    setIsRefreshing(true);
    try {
      await fetchInventory();

      if (prioritizeInventory) {
        setReportsReady(true);
      }

      await fetchDashboardStats();
      setReportsRefreshKey((prev) => prev + 1);
      setMessage("");
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    const lowStockItems = items.filter(
      (item) => Number(item.quantity) === 0,
    ).length;

    setStats((prev) => ({
      ...prev,
      totalProducts: items.length,
      lowStockItems,
    }));
  }, [items]);

  // const fetchItems = async () => {
  //   setLoading(true);
  //   const res = await fetch(...);
  //   const data = await res.json();
  //   setItems(data);
  //   setLoading(false)
  // }

  useEffect(() => {
    document.title = "The Suites Warehouse";

    const bootstrap = async () => {
      await refreshAll({ prioritizeInventory: true });
    };

    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Add Product
  const handleAddNewProduct = async () => {
    if (!newProductName.trim()) return setMessage("Enter product name");
    try {
      await api.post("/api/products", {
        name: newProductName,
        minStock: Number(newProductMinStock) || 5,
        initialQty: Number(newProductQty) || 0,
        unit: newProductUnit,
      });
      setNewProductName("");
      setNewProductMinStock("");
      setNewProductQty("");
      await refreshAll();
      setMessage("Product added successfully!");
    } catch (err) {
      console.error(err);
      setMessage("Failed to add product");
    }
  };

  // Stock In
  const handleStockIn = async () => {
    if (!stockInProduct || !stockInQty)
      return setMessage("Select product & quantity");
    try {
      await api.post("/api/stock-in", {
        product: stockInProduct,
        quantity: Number(stockInQty),
        source: "Main Hotel",
        unit: stockInUnit,
      });
      setStockInProduct("");
      setStockInQty("");
      await refreshAll();
      setMessage("Stock In successful!");
    } catch (err) {
      console.error(err);
      setMessage("Stock In failed");
    }
  };

  // Stock Out
  const handleStockOut = async () => {
    if (!stockOutProduct || !stockOutQty)
      // || !usedBy || !floor
      return setMessage("Fill all Stock Out fields");
    try {
      await api.post("/api/stock-out", {
        productId: stockOutProduct,
        quantity: Number(stockOutQty),
        unit: stockOutUnit,
      });
      setStockOutProduct("");
      setStockOutQty("");
      setStockOutUnit("pcs");
      // setUsedBy("");
      // setFloor("");
      await refreshAll();
      setMessage("Stock Out successful!");
    } catch (err) {
      console.error(err);
      setMessage("Stock Out failed");
    }
  };

  const handleDeleteProduct = async (id) => {
    if (!id) return setMessage("No product ID");
    try {
      await api.delete(`/api/delete/${id}`);
      await refreshAll();
      setMessage("Product deleted successfully!");
    } catch (err) {
      console.error(err);
      setMessage("Delete failed");
    }
  };

  const handleClearAllData = async () => {
    const isConfirmed = window.confirm(
      "This will permanently delete ALL inventory, stock in/out records, and report data. This action cannot be undone. Continue?",
    );

    if (!isConfirmed) return;

    try {
      await api.delete("/api/delete/all/data");
      await refreshAll();
      setMessage("All warehouse data has been cleared successfully.");
    } catch (err) {
      console.error(err);
      setMessage("Failed to clear all data.");
    }
  };

  const filteredItems = items.filter((item) =>
    item.product.toLowerCase().includes(searchTerm.toLowerCase()),
  );

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
        onClick={() => refreshAll()}
        className="btn btn-primary refresh-btn"
        disabled={isRefreshing}
      >
        {isRefreshing ? "Refreshing..." : "Refresh Data"}
      </button>

      <section className="stats-grid">
        <article className="stat-card stat-total">
          <p className="stat-label">Total Products</p>
          <h3 className="stat-value">{stats.totalProducts}</h3>
        </article>
        <article className="stat-card stat-low">
          <p className="stat-label">Low Stock Items</p>
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
              placeholder="Initial Qty"
              value={newProductQty}
              onChange={(e) => setNewProductQty(e.target.value)}
            />

            <select
              value={newProductUnit}
              onChange={(e) => setNewProductUnit(e.target.value)}
              placeholder="Unit (pcs, galon, bag)"
            >
              <option value="pcs">pcs</option>
              <option value="galon">galon</option>
              <option value="bag">bag</option>
            </select>

            {/* <input
              className="input"
              type="number"
              placeholder="Min Stock"
              value={newProductMinStock}
              onChange={(e) => setNewProductMinStock(e.target.value)}
            /> */}
          </div>
          <div className="card-actions">
            <button
              onClick={handleAddNewProduct}
              className="btn btn-primary"
              style={{ width: "140px" }}
            >
              Add Product
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
              {items.map((item) => (
                <option key={item._id} value={item._id}>
                  {item.product} {item.unit}
                </option>
              ))}
            </select>

            <input
              className="input"
              type="number"
              placeholder="Quantity"
              value={stockInQty}
              onChange={(e) => setStockInQty(e.target.value)}
            />

            <select
              value={stockInUnit}
              onChange={(e) => setStockInUnit(e.target.value)}
            >
              <option value="pcs">pcs</option>
              <option value="galon">galon</option>
              <option value="bag">bag</option>
            </select>
          </div>
          <div className="card-actions">
            <button
              onClick={handleStockIn}
              className="btn btn-primary"
              style={{ width: "100px" }}
            >
              Add
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
              {items.map((item) => (
                <option key={item._id} value={item._id}>
                  {item.product} {item.unit}
                </option>
              ))}
            </select>

            <input
              className="input"
              type="number"
              placeholder="Quantity"
              value={stockOutQty}
              onChange={(e) => setStockOutQty(e.target.value)}
            />

            <select
              style={{
                padding: "8px",
                borderRadius: "8px",
                outline: "none",
                marginRight: "1.2rem",
                marginBlock: "5px",
              }}
              value={stockOutUnit}
              onChange={(e) => setStockOutUnit(e.target.value)}
            >
              <option value="pcs">pcs</option>
              <option value="gallon">gallon</option>
              <option value="bag">bag</option>
            </select>

            {/* <input
              className="input"
              placeholder="Floor"
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
            /> */}

            {/* <input
              className="input"
              placeholder="Used By"
              value={usedBy}
              onChange={(e) => setUsedBy(e.target.value)}
            /> */}
          </div>
          <div className="card-actions">
            <button onClick={handleStockOut} className="btn btn-danger" style={{ width: "110px" }}>
              Remove
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

      <section className="danger-zone">
        <h2>Admin: Dangerous Action</h2>
        <p>
          Permanently remove all inventory data, stock-in and stock-out records.
          Use this only when you want to reset the system completely.
        </p>
        <button onClick={handleClearAllData} className="btn btn-clear-all">
          Clear All Data
        </button>
      </section>
      <h2 className="inventory-title">Current Inventory</h2>
      <div className="inventory-table-wrapper">
        {inventoryLoading ? (
          <p className="loading-state">Loading inventory...</p>
        ) : (
          <table className="inventory-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Quantity</th>
                <th>Unit</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {[...filteredItems]
                .sort((a, b) => {
                  const aLow = Number(a.quantity) === 0;
                  const bLow = Number(b.quantity) === 0;
                  return aLow - bLow;
                })
                .map((item) => {
                  const isLowStock = Number(item.quantity) === 0;

                  return (
                    <tr key={item._id}>
                      <td data-label="product">{item.product}</td>
                      <td data-label="quantity">{item.quantity}</td>
                      <td data-label="unit">{item.unit}</td>

                      <td data-label="status">
                        <span className={`status-pill ${isLowStock ? "low" : "ok"}`}>
                          {isLowStock ? "Low Stock" : "In Stock"}
                        </span>
                      </td>

                      <td data-label="action">
                        <button
                          className="delete-btn"
                          onClick={() => handleDeleteProduct(item._id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
      </div>
      <Reports refreshKey={reportsRefreshKey} enabled={reportsReady} />
    </div>
  );
}

export default App;
