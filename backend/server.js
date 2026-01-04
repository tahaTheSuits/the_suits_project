const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv').config();
//const path = require('path');
const stockOutRoutes = require('./routes/stockOutRoutes');
const productRoutes = require('./routes/productsRoute');
const stockInRoutes = require('./routes/stockInRoutes');
const inventoryRoute = require('./routes/inventoryRoute');
const deleteRoute = require('./routes/deleteRoute');
const dailyReportsRoute = require('./routes/dailyReportsRoute');
const reportExportRoute = require('./routes/reportExportRoute');
const reportRoute = require('./routes/reportRoute');


const app = express();


// Middleware
app.use(express.json());
app.use(cors(
    { origin: 'https://thesuits.netlify.app', 
        //credentials: true, 
    }
));
//app.use('/api',require('./routes/stockRoutes'));
app.use(express.urlencoded({ extended: true }));
app.use('/api/stock-in', stockInRoutes);
app.use('/api/products', productRoutes);
app.use('/api/stock-out', stockOutRoutes);
app.use('/api/inventory', inventoryRoute);
app.use('/api/daily-reports', dailyReportsRoute);
app.use('/api/delete', deleteRoute);
app.use('/api/reports', reportRoute);
app.use('/api/export', reportExportRoute);
//app.use('/api/export', reportExportRoute);


// routes
app.get('/', (req, res) => {
    res.send('Welcome to the API');
});


// port
const PORT = process.env.PORT || 5000;

// MongoDB connection
mongoose
.connect(process.env.MONGO_URI)
    .then(() => { 
        app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });
    })
    .catch((err) => console.error('MongoDB connection error:', err));