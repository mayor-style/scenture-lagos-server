const express = require('express');
const router = express.Router();
const {
  createOrder,
  getShippingRates,
  getPaymentMethods,
  // processPayment, // Removed for clarity, see controller analysis
  getOrder,
  getMyOrders,
  cancelOrder,
  trackOrder,
  initializePayment,
  verifyPayment
} = require('../controllers/order.controller');

// Import your authentication middleware
const { protect } = require('../middleware/auth.middleware'); // Assuming you have this

// --- Public Routes ---
router.get('/shipping-rates', getShippingRates);
router.get('/payment-methods', getPaymentMethods);
router.post('/', createOrder); // Allows guest and authenticated creation
router.get('/verify-payment/:reference', verifyPayment);
router.get('/:id', getOrder);
router.post('/:id/initialize-payment', initializePayment);
router.get('/:id/tracking', trackOrder);

// --- Private Routes (Require Authentication) ---
router.get('/my-orders', protect, getMyOrders);
router.post('/:id/cancel', protect, cancelOrder);

// This route might be redundant if only using Paystack
// router.post('/:id/payment', processPayment);

module.exports = router;