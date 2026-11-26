// Stock Out card: barcode scanning plus the usual manual product selection.
//
// Scanning: a USB keyboard-wedge scanner "types" the code into the scan field
// and presses Enter -> the product is looked up, selected (its own unit is
// used automatically) and the quantity field is focused with 1 pre-filled, so
// Enter records it. Camera scanning is offered where the browser supports it.
//
// Safety:
//  - one submission at a time (a ref lock, not just state, so two very fast
//    Enter presses cannot both send)
//  - every intended stock out carries a clientRequestId; if a request fails
//    without a definite answer (timeout / network), the next attempt reuses
//    the id so the server records it at most once
//  - a retryable 409 (concurrent stock out rolled back) is retried once
//  - repeated scans of the same code within a second are ignored
import { useCallback, useEffect, useRef, useState } from "react";
import { api, cameraScanSupported, getErrorMessage, lookupBarcode, newRequestId, sleep } from "../api.js";
import CameraScanner from "./CameraScanner.jsx";
import { isTodayLocked, lockMessage, usePeriodLock } from "../periodLock.js";

const DUPLICATE_SCAN_MS = 1000;

export default function StockOutCard({ activeItems, onRecorded, setMessage }) {
  const [scanCode, setScanCode] = useState("");
  const [productId, setProductId] = useState("");
  const [scannedProduct, setScannedProduct] = useState(null);
  const [qty, setQty] = useState("");
  const [lookup, setLookup] = useState({ status: "idle", message: "" });
  const [saving, setSaving] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraAvailable] = useState(cameraScanSupported);

  const scanInputRef = useRef(null);
  const qtyInputRef = useRef(null);
  const savingRef = useRef(false);
  const lookupRef = useRef({ inFlight: false, code: "", at: 0 });
  const pendingRequestIdRef = useRef(null);
  const cameUsingScanRef = useRef(false);
  const lock = usePeriodLock();
  const todayLocked = isTodayLocked(lock);

  // Prefer fresh inventory data; fall back to the lookup result if the
  // product is not in the loaded list yet.
  const item =
    activeItems.find((i) => i._id === productId) ||
    (scannedProduct && scannedProduct._id === productId ? scannedProduct : null);

  // Changing what will be submitted starts a new intended stock out.
  useEffect(() => {
    pendingRequestIdRef.current = null;
  }, [productId, qty]);

  const runLookup = useCallback(async (rawCode) => {
    const code = rawCode.trim();
    if (!code) return;
    const last = lookupRef.current;
    if (last.inFlight) return;
    if (code === last.code && Date.now() - last.at < DUPLICATE_SCAN_MS) return;

    lookupRef.current = { inFlight: true, code, at: Date.now() };
    setLookup({ status: "loading", message: `Looking up ${code}...` });
    try {
      const product = await lookupBarcode(code);
      setScannedProduct(product);
      setProductId(product._id);
      setQty("1");
      cameUsingScanRef.current = true;
      setLookup({
        status: "matched",
        message: `${product.product} · ${product.quantity} ${product.unit} available`,
      });
      requestAnimationFrame(() => {
        qtyInputRef.current?.focus();
        qtyInputRef.current?.select();
      });
    } catch (err) {
      setLookup({ status: "error", message: getErrorMessage(err, `Barcode lookup failed for "${code}"`) });
      requestAnimationFrame(() => scanInputRef.current?.select());
    } finally {
      lookupRef.current = { inFlight: false, code, at: Date.now() };
      setScanCode("");
    }
  }, []);

  const handleCameraDetected = useCallback(
    (code) => {
      setCameraOpen(false);
      runLookup(code);
    },
    [runLookup],
  );
  const closeCamera = useCallback(() => setCameraOpen(false), []);

  const selectManually = (id) => {
    setProductId(id);
    setScannedProduct(null);
    cameUsingScanRef.current = false;
    setLookup({ status: "idle", message: "" });
  };

  const submit = async () => {
    if (savingRef.current) return;
    const quantity = Number(qty);
    if (!item || !qty) return setMessage("Fill all Stock Out fields");
    if (!Number.isFinite(quantity) || quantity <= 0) return setMessage("Quantity must be a positive number");

    savingRef.current = true;
    setSaving(true);
    const requestId = pendingRequestIdRef.current || newRequestId();
    pendingRequestIdRef.current = requestId;
    const body = { productId: item._id, quantity, unit: item.unit, clientRequestId: requestId };

    try {
      let res;
      try {
        res = await api.post("/api/stock-out", body);
      } catch (err) {
        // The server rolled the first attempt back; retry once.
        if (err?.response?.status === 409 && err.response.data?.retryable) {
          await sleep(400);
          res = await api.post("/api/stock-out", body);
        } else {
          throw err;
        }
      }

      pendingRequestIdRef.current = null;
      const data = res.data.data;
      setMessage(
        res.data.duplicate
          ? `Already recorded: ${data.quantity} ${data.unit} of ${item.product} (duplicate ignored).`
          : `Stock Out: ${data.quantity} ${data.unit} of ${item.product}. Remaining ${data.remainingQuantity} ${data.unit}.`,
      );
      const fromScan = cameUsingScanRef.current;
      setProductId("");
      setScannedProduct(null);
      setQty("");
      setLookup({ status: "idle", message: "" });
      await onRecorded();
      if (fromScan) requestAnimationFrame(() => scanInputRef.current?.focus());
    } catch (err) {
      console.error(err);
      // A definite server answer (4xx) means nothing was recorded: the next
      // attempt gets a new id. No answer / 5xx: keep the id so a resubmit
      // cannot record the same stock out twice.
      const status = err?.response?.status;
      if (status && status < 500) pendingRequestIdRef.current = null;
      setMessage(getErrorMessage(err, "Stock Out failed"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const onEnter = (handler) => (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handler();
    }
  };

  return (
    <div className="card">
      <h2>Stock Out</h2>

      <div className="scan-row">
        <input
          ref={scanInputRef}
          className="input scan-input"
          placeholder="Scan or type barcode, then Enter"
          value={scanCode}
          onChange={(e) => setScanCode(e.target.value)}
          onKeyDown={onEnter(() => runLookup(scanCode))}
          autoComplete="off"
          spellCheck={false}
          aria-label="Barcode"
        />
        {cameraAvailable && (
          <button
            type="button"
            className="history-btn"
            onClick={() => setCameraOpen((open) => !open)}
            title="Scan with the camera"
          >
            {cameraOpen ? "Close" : "Camera"}
          </button>
        )}
      </div>
      {cameraOpen && <CameraScanner onDetected={handleCameraDetected} onClose={closeCamera} />}
      {lookup.message && (
        <p className={`scan-status ${lookup.status}`} role="status">
          {lookup.status === "matched" ? "✓ " : ""}
          {lookup.message}
        </p>
      )}

      <div className="from-row">
        <select value={productId} onChange={(e) => selectManually(e.target.value)}>
          <option value="">Select Product</option>
          {activeItems.map((p) => (
            <option key={p._id} value={p._id}>
              {p.product} ({p.unit})
            </option>
          ))}
        </select>

        <input
          ref={qtyInputRef}
          className="input"
          type="number"
          min="1"
          placeholder="Quantity"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onKeyDown={onEnter(submit)}
        />

        <span className="unit-tag" title="Movements are recorded in the product's unit">
          {item ? item.unit : "unit"}
        </span>
      </div>
      {item && (
        <p className="field-hint">
          Available: {item.quantity} {item.unit}
          {item.barcode ? ` · barcode ${item.barcode}` : ""}
        </p>
      )}
      {todayLocked && <p className="lock-warning">🔒 {lockMessage(lock.lockedThroughDate)}</p>}
      <div className="card-actions">
        <button onClick={submit} className="btn btn-danger" style={{ width: "110px" }} disabled={saving || todayLocked}>
          {saving ? "Saving..." : "Remove"}
        </button>
      </div>
    </div>
  );
}
