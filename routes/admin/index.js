const express = require('express');

// Import admin route modules
const usersRoutes = require('./users.routes');
const dashboardRoutes = require('./dashboard.routes');
const productsRoutes = require('./products.routes');
const categoriesRoutes = require('./categories.routes');
const ordersRoutes = require('./orders.routes');
const customersRoutes = require('./customers.routes');
const inventoryRoutes = require('./inventory.routes');
const settingsRoutes = require('./settings.routes');
const contactRoutes = require('./contact.routes');

const router = express.Router();

// Mount admin route modules
router.use('/users', usersRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/products', productsRoutes);
router.use('/categories', categoriesRoutes);
router.use('/orders', ordersRoutes);
router.use('/customers', customersRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/settings', settingsRoutes);
router.use('/contact', contactRoutes);

module.exports = router;