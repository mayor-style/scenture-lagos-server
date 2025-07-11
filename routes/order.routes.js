const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth.middleware');
const {
  createOrder,
  getShippingMethods,
  getPaymentMethods,
  processPayment,
  getOrder
} = require('../controllers/order.controller');

// Public routes
router.get('/shipping-methods', getShippingMethods);
router.get('/payment-methods', getPaymentMethods);

// Protected routes (customer only)
router.post('/', protect, authorize('customer'), createOrder);
router.get('/:id', protect, authorize('customer'), getOrder);
router.post('/:id/payment', protect, authorize('customer'), processPayment);

module.exports = router;