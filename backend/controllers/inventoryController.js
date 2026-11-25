const Product = require("../models/productModel");
const {
  computeLedger,
  effectiveMinStock,
  stockStatus,
  productUnitOf,
} = require("../utils/stock");

// Get Inventory
// GET /api/inventory                       -> active products only
// GET /api/inventory?includeArchived=true  -> active + archived products
exports.getInventory = async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === "true";
    const filter = includeArchived ? {} : { isActive: { $ne: false } };

    const products = await Product.find(filter).sort({ name: 1 }).lean();
    const ledger = await computeLedger(products);

    const inventory = products.map((product) => {
      const totals = ledger.get(String(product._id));
      const minStock = effectiveMinStock(product.minStock);

      return {
        _id: product._id,
        product: product.name,
        quantity: totals.quantity,
        totalIn: totals.totalIn,
        totalOut: totals.totalOut,
        unit: productUnitOf(product),
        minStock: minStock.value,
        minStockIsDefault: minStock.isDefault,
        status: stockStatus(totals.quantity, minStock.value),
        isActive: product.isActive !== false,
        archivedAt: product.archivedAt || null,
        unitConflicts: totals.unitConflicts,
      };
    });

    res.json(inventory);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};
