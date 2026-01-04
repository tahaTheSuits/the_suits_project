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

  const [unit, setUnit] = useState("pcs");
  const [loading, setLoading] = useState(true);

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

  const [newProductUnit, setNewProductUnit] = useState("pcs");
  const [stockInUnit, setStockInUnit] = useState("pcs");

  // Fetch Inventory
  const fetchInventory = async () => {
    try {
      setLoading(true);
      const res = await axios.get(
        "https://the-suits-project.onrender.com/api/inventory"
      );
      dispatch(setInventory(res.data || []));
      setMessage("");
    } catch (err) {
      console.error(err);
      setMessage("Error fetching inventory");
    } finally {
      setLoading(false);
    }
  };

  // Fetch Daily Report
  const fetchDailyReport = async () => {
    try {
      const res = await axios.get(
        "https://the-suits-project.onrender.com/api/daily-reports"
      );
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

  // const fetchItems = async () => {
  //   setLoading(true);
  //   const res = await fetch(...);
  //   const data = await res.json();
  //   setItems(data);
  //   setLoading(false)
  // }

  useEffect(() => {
    document.title = "The Suits Warehouse";
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Add Product
  const handleAddNewProduct = async () => {
    if (!newProductName.trim()) return setMessage("Enter product name");
    try {
      await axios.post("https://the-suits-project.onrender.com/api/products", {
        name: newProductName,
        minStock: Number(newProductMinStock) || 5,
        initialQty: Number(newProductQty) || 0,
        unit: newProductUnit,
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
      await axios.post("https://the-suits-project.onrender.com/api/stock-in", {
        product: stockInProduct,
        quantity: Number(stockInQty),
        source: "Main Hotel",
        unit: stockInUnit,
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
      await axios.post("https://the-suits-project.onrender.com/api/stock-out", {
        product: stockOutProduct,
        quantity: Number(stockOutQty),
        usedBy,
        floor,
        unit,
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
      await axios.delete(
        `https://the-suits-project.onrender.com/api/delete/${id}`
      );
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
      <header className="app-header">
        <img className="logo" src={logo} alt="Logo" />
        <h1 className="title">
          <FaHome /> The Suits Warehouses
        </h1>
      </header>

      {message && <p className="error-msg">{message}</p>}

      <button onClick={refreshAll} className="btn btn-primary refresh-btn">
        Refresh Data 🔄
      </button>

      {/* Add Product */}
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
              placeholder="Unit (pcs, carton, bag)"
            >
              <option value="pcs">pcs</option>
              <option value="carton">carton</option>
              <option value="bag">bag</option>
            </select>

            <input
              className="input"
              type="number"
              placeholder="Min Stock"
              value={newProductMinStock}
              onChange={(e) => setNewProductMinStock(e.target.value)}
            />
          </div>
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
              <option value="carton">carton</option>
              <option value="bag">bag</option>
            </select>
          </div>
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
              value={newProductUnit}
              onChange={(e) => setUnit(e.target.value)}
            >
              <option value="pcs">pcs</option>
              <option value="carton">carton</option>
              <option value="bag">bag</option>
            </select>

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
          </div>
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
          <div className="from-row">
            <input
              className="input"
              placeholder="Search product..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>
      {/* Inventory Grid */}
      <h2 className="inventory-title">Current Inventory:</h2>
      <div className="inventory-table-wrapper">
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
                  const aLow = a.quantity < 1;
                  const bLow = b.quantity < 4;
                  return aLow - bLow; // الأخضر فوق، الأحمر تحت
                })
                .map((item) => {
                  const isLowStock = item.quantity < 1;

                  return (
                    <tr key={item._id}>
                      <td data-label="product">{item.product}</td>
                      <td data-label="quantity">{item.quantity}</td>
                      <td data-label="unit">{item.unit}</td>

                      <td data-label="status">
                        <span
                          className={`status-dot ${
                            isLowStock ? "red" : "green"
                          }`}
                        />
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
      {/* Dashboard يظهر مرة واحدة فقط تحت */}
      {/* <Dashboard refreshKey={reportsRefreshKey} /> */}

      {/* Reports component */}
      <Reports refreshKey={reportsRefreshKey} />
    </div>
  );
}

export default App;
