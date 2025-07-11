const express = require('express');
const {
  getSettings,
  updateSettings,
  addShippingZone,
  updateShippingZone,
  deleteShippingZone,
  addPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod
} = require('../../controllers/admin/settings.controller');

const { protect, authorize } = require('../../middleware/auth.middleware');

const router = express.Router();

// Apply protection and authorization to all routes
router.use(protect);
router.use(authorize('admin', 'superadmin'));

router
  .route('/')
  .get(getSettings)
  .put(updateSettings);

// Shipping zones routes
router
  .route('/shipping-zones')
  .post(addShippingZone);

router
  .route('/shipping-zones/:id')
  .put(updateShippingZone)
  .delete(deleteShippingZone);

// Payment methods routes
router
  .route('/payment-methods')
  .post(addPaymentMethod);

router
  .route('/payment-methods/:id')
  .put(updatePaymentMethod)
  .delete(deletePaymentMethod);

module.exports = router;