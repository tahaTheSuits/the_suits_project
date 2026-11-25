// DELETE /api/delete/:id used to hard-delete a product AND all of its
// StockIn/StockOut records, which erased history from every report.
// It is kept only for backward compatibility (e.g. a cached old frontend)
// and now performs a soft archive instead. Nothing is deleted.
const { archiveProduct } = require("./productsController");

exports.deleteProduct = archiveProduct;
