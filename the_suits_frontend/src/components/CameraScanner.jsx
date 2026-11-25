// Optional camera scanning using the browser's built-in BarcodeDetector API
// (Chrome / Edge on Android, ChromeOS, macOS and some Windows builds).
// No extra library: where the API is missing the camera button is simply not
// shown, and keyboard-wedge (USB) scanners or manual entry still work.
// The camera needs HTTPS (or localhost) and the user's permission.
import { useEffect, useRef, useState } from "react";

// Use cameraScanSupported() from api.js before rendering this component.
export default function CameraScanner({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Starting camera...");

  useEffect(() => {
    let stream;
    let timer;
    let stopped = false;

    const start = async () => {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        if (!supported.length) throw new Error("This browser cannot read barcodes from the camera.");
        const detector = new window.BarcodeDetector({ formats: supported });

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (stopped) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStatus("Point the camera at a barcode");

        let busy = false;
        timer = setInterval(async () => {
          if (busy || stopped || !videoRef.current || videoRef.current.readyState < 2) return;
          busy = true;
          try {
            const codes = await detector.detect(videoRef.current);
            const value = codes.find((c) => c.rawValue?.trim())?.rawValue.trim();
            if (value && !stopped) {
              stopped = true;
              clearInterval(timer);
              onDetected(value);
            }
          } catch {
            // A single failed frame is not an error; keep scanning.
          } finally {
            busy = false;
          }
        }, 250);
      } catch (err) {
        setError(
          err?.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access or use a USB scanner / manual entry."
            : err?.message || "Could not start the camera.",
        );
      }
    };

    start();
    return () => {
      stopped = true;
      clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onDetected]);

  return (
    <div className="camera-scanner">
      {error ? (
        <p className="section-error">{error}</p>
      ) : (
        <>
          <video ref={videoRef} className="camera-video" muted playsInline />
          <p className="field-hint">{status}</p>
        </>
      )}
      <button className="link-btn" onClick={onClose}>
        Close camera
      </button>
    </div>
  );
}
