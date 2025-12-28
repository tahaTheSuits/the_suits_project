// src/App.jsx
import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  setInventory,
  setDailyReport,
} from "./features/inventory/inventorySlice.js";
import axios from "axios";
import { FaBox, FaHome } from "react-icons/fa";
//import Dashboard from "./pages/Dashboard.jsx";
import Reports from "./components/reports.jsx";
import logo from "./assets/logo2.png";
import "./App.css";

function App() {
  const dispatch = useDispatch();
  const items = useSelector((state) => state.inventory.items || []);
  const [message, setMessage] = useState("");
  const [reportsRefreshKey, setReportsRefreshKey] = useState(0);

  // Stock in/out fields
  const [stockInProduct, setStockInProduct] = useState("");
  const [stockInQty, setStockInQty] = useState("");
  const [stockOutProduct, setStockOutProduct] = useState("");
  const [stockOutQty, setStockOutQty] = useState("");
  const [usedBy, setUsedBy] = useState("");
  const [floor, setFloor] = useState("");

  // New product
  const [newProductName, setNewProductName] = useState("");
  const [newProductQty, setNewProductQty] = useState("");
  const [newProductMinStock, setNewProductMinStock] = useState("");

  const [searchTerm, setSearchTerm] = useState("");

  // Fetch Inventory
  const fetchInventory = async () => {
    try {
      const res = await axios.get("http://localhost:5000/api/inventory");
      dispatch(setInventory(res.data || []));
      setMessage("");
    } catch (err) {
      console.error(err);
      setMessage("Error fetching inventory");
    }
  };

  // Fetch Daily Report
  const fetchDailyReport = async () => {
    try {
      const res = await axios.get("http://localhost:5000/api/daily-reports");
      dispatch(setDailyReport(res.data || []));
    } catch (err) {
      console.error(err);
      setMessage("Error fetching daily report");
    }
  };

  const refreshAll = async () => {
    await fetchInventory();
    await fetchDailyReport();
    setReportsRefreshKey((prev) => prev + 1);
  };

  useEffect(() => {
    document.title = "The Suits Warehouse";
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Add Product
  const handleAddNewProduct = async () => {
    if (!newProductName.trim()) return setMessage("Enter product name");
    try {
      await axios.post("http://localhost:5000/api/products", {
        name: newProductName,
        minStock: Number(newProductMinStock) || 5,
        initialQty: Number(newProductQty) || 0,
      });
      setNewProductName("");
      setNewProductMinStock("");
      setNewProductQty("");
      refreshAll();
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
      await axios.post("http://localhost:5000/api/stock-in", {
        product: stockInProduct,
        quantity: Number(stockInQty),
        source: "Main Hotel",
      });
      setStockInProduct("");
      setStockInQty("");
      refreshAll();
      setMessage("Stock In successful!");
    } catch (err) {
      console.error(err);
      setMessage("Stock In failed");
    }
  };

  // Stock Out
  const handleStockOut = async () => {
    if (!stockOutProduct || !stockOutQty || !usedBy || !floor)
      return setMessage("Fill all Stock Out fields");
    try {
      await axios.post("http://localhost:5000/api/stock-out", {
        product: stockOutProduct,
        quantity: Number(stockOutQty),
        usedBy,
        floor,
      });
      setStockOutProduct("");
      setStockOutQty("");
      setUsedBy("");
      setFloor("");
      refreshAll();
      setMessage("Stock Out successful!");
    } catch (err) {
      console.error(err);
      setMessage("Stock Out failed");
    }
  };

  const handleDeleteProduct = async (id) => {
    if (!id) return setMessage("No product ID");
    try {
      await axios.delete(`http://localhost:5000/api/delete/${id}`);
      refreshAll();
      setMessage("Product deleted successfully!");
    } catch (err) {
      console.error(err);
      setMessage("Delete failed");
    }
  };

  const filteredItems = items.filter((item) =>
    item.product.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="container">
      {/* Header */}
      <header
        className="app-header"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "20px",
          marginBottom: "30px",
        }}
      >
        <img
          src={logo}
          alt="Logo"
          style={{ width: "180px", marginLeft: "-50px", marginTop: "-90px" }}
        />
        <h1
          style={{
            fontSize: "45px",
            justifyContent: "center",
            alignItems: "center",
            marginLeft: "200px",
            marginTop: "70px",
            color: "#333",
          }}
        >
          <FaHome /> The Suits Warehouses
        </h1>
      </header>

      {message && (
        <p
          style={{
            color: "red",
            marginLeft: "350px",
            marginBottom: "-85px",
            marginTop: " 100px",
          }}
        >
          {message}
        </p>
      )}

      <button onClick={refreshAll} className="btn btn-primary refresh-btn">
        Refresh Data 🔄
      </button>

      {/* Add Product */}
      <div className="card">
        <h2>Add New Product</h2>

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

        <input
          className="input"
          type="number"
          placeholder="Min Stock"
          value={newProductMinStock}
          onChange={(e) => setNewProductMinStock(e.target.value)}
        />

        <button
          onClick={handleAddNewProduct}
          className="btn btn-primary"
          style={{ width: "140px" }}
        >
          Add Product ➕
        </button>
      </div>

      {/* Stock In */}
      <div className="card">
        <h2>Stock In</h2>

        <select
          style={{ width: "97.5%", outline: "none" }}
          className="input"
          value={stockInProduct}
          onChange={(e) => setStockInProduct(e.target.value)}
        >
          <option value="">Select Product</option>
          {items.map((item) => (
            <option key={item._id} value={item._id}>
              {item.product}
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

        <button
          onClick={handleStockIn}
          className="btn btn-primary"
          style={{ width: "100px" }}
        >
          Add 📦
        </button>
      </div>

      {/* Stock Out */}
      <div className="card">
        <h2>Stock Out</h2>

        <select
          style={{ width: "97.5%" }}
          className="input"
          value={stockOutProduct}
          onChange={(e) => setStockOutProduct(e.target.value)}
        >
          <option value="">Select Product</option>
          {items.map((item) => (
            <option key={item._id} value={item._id}>
              {item.product}
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

        <input
          className="input"
          placeholder="Floor"
          value={floor}
          onChange={(e) => setFloor(e.target.value)}
        />

        <input
          className="input"
          placeholder="Used By"
          value={usedBy}
          onChange={(e) => setUsedBy(e.target.value)}
        />

        <button
          onClick={handleStockOut}
          className="btn btn-danger"
          style={{ width: "110px", backgroundColor: "#552f0f" }}
        >
          Remove 🗑
        </button>
      </div>

      {/* Search Inventory */}
      <div className="card">
        <h2>Search Inventory 🔍</h2>
        <input
          className="input"
          placeholder="Search product..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Inventory Grid */}
      <h2 style={{ marginLeft: "65px", marginTop: "100px", fontSize: "35px" }}>
        Current Inventory:
      </h2>
      <div className="stock-card">
        {filteredItems.map((item) => {
          const isLowStock = item.quantity < item.minStock;
          return (
            <div
              key={item._id}
              className={`title ${isLowStock ? "low-stock" : "high-stock"}`}
            >
              <FaBox size={18} />
              <h3>{item.product}</h3>
              <p>Qty: {item.quantity}</p>
              <button onClick={() => handleDeleteProduct(item._id)}>
                Delete 🗑
              </button>
            </div>
          );
        })}
      </div>

      {/* Dashboard يظهر مرة واحدة فقط تحت */}
      {/* <Dashboard refreshKey={reportsRefreshKey} /> */}

      {/* Reports component */}
      <Reports refreshKey={reportsRefreshKey} />
    </div>
  );
}

export default App;
