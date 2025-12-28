const mongoose = require("mongoose");
const Product = require("../models/productModel");
const StockIn = require("../models/stockInModel");





// Create Product

exports.createProduct = async (req, res) => {
  try {
    const { name, minStock, initialQty } = req.body;

    const existingProduct = await Product.findOne({
      name: name.trim()
    });

    if (existingProduct) {
      return res.status(400).json({
        message: "Product already exists"
      });
    }

    const product = await Product.create({
      name: name.trim(),
      minStock: Number(minStock) || 5,
    });

    if (initialQty && Number(initialQty) > 0) {
      await StockIn.create({
        product: product._id,
        quantity: Number(initialQty),
        source: "Initial Stock",
      });
    }

    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
// exports.createProduct = async (req, res) => {
//   console.log(req.body)
//   try {
//     const { name, minStock, initialQty } = req.body;
//     const product = await Product.create({
//       name,
//       minStock: Number(minStock) || 5
//     });

//     if (initialQty && Number(initialQty) > 0) {
//       await StockIn.create({
//         product: product._id,
//         quantity: Number(initialQty),
//         source: "Initial Stock"
//       });
//     }

//     res.status(201).json(product);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: err.message });
//   }
// };


// exports.createProduct = async (req, res) => {
//   try {
//     const { name, minStock } = req.body;

//     const product = await Product.create({
//       name,
//       minStock
//     });

//     res.status(201).json(product);
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// };


// productsController.js
// exports.deleteProduct = async (req, res) => {
//   try {
//     const { id } = req.params; // أو id لو تستخدم _id
//     const deleted = await Product.findOneAndDelete( id ); // أو {_id: id}
//     if (!deleted) return res.status(404).json({ message: "Product not found" });
//     res.json({ message: `Product "${deleted.name}" deleted successfully` });
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };