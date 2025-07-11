const express = require('express');

// Import route modules
const authRoutes = require('./auth.routes');
const adminRoutes = require('./admin');
const customerRoutes = require('./customer.routes');
const productRoutes = require('./product.routes');
const categoryRoutes = require('./category.routes');
const cartRoutes = require('./cart.routes');
const orderRoutes = require('./order.routes');
const checkoutRoutes = require('./checkout.routes');
const searchRoutes = require('./search.routes');
const contactRoutes = require('./contact.routes');

const router = express.Router();

// Mount route modules
router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/customer', customerRoutes);
router.use('/products', productRoutes);
router.use('/categories', categoryRoutes);
router.use('/cart', cartRoutes);
router.use('/orders', orderRoutes);
router.use('/checkout', checkoutRoutes);
router.use('/search', searchRoutes);
router.use('/contact', contactRoutes);

// API health check route
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'API is running',
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString()
    }
  });
});

module.exports = router;