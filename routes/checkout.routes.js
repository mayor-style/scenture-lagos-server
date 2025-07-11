const express = require('express');
const router = express.Router();
const {
  initializeCheckout,
  getCheckoutSession,
  updateShipping,
  updatePayment
} = require('../controllers/checkout.controller');

// Public routes
router.post('/initialize', initializeCheckout);
router.get('/', getCheckoutSession);
router.post('/shipping', updateShipping);
router.post('/payment', updatePayment);

module.exports = router;