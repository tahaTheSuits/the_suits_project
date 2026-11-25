// Barcode normalization. Barcodes are stored as strings exactly as scanned
// (only surrounding whitespace is trimmed), so leading zeros are kept
// ("0012345" != "12345"). Comparison is case-insensitive via collation.

const BARCODE_MAX = 64;
// Printable ASCII without spaces covers EAN/UPC/Code 39/Code 128/QR text.
const BARCODE_PATTERN = /^[\x21-\x7E]+$/;
const BARCODE_COLLATION = { locale: "en", strength: 2 };

// null / undefined / "" / whitespace -> null (no barcode)
function normalizeBarcode(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

// Returns { value } (string or null) or { error }.
function validateBarcode(value) {
  const normalized = normalizeBarcode(value);
  if (normalized === null) return { value: null };
  if (normalized.length > BARCODE_MAX) {
    return { error: `Barcode must be at most ${BARCODE_MAX} characters.` };
  }
  if (!BARCODE_PATTERN.test(normalized)) {
    return { error: "Barcode may only contain letters, digits and symbols (no spaces)." };
  }
  return { value: normalized };
}

module.exports = { BARCODE_COLLATION, normalizeBarcode, validateBarcode };
