const express = require('express');
const {
  getSettings,
  updateSettings,
  addShippingZone,
  updateShippingZone,
  deleteShippingZone,
  addPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
  // --- IMPORT THE NEW FUNCTIONS ---
  addRateToZone,
  updateRateInZone,
  deleteRateFromZone
} = require('../../controllers/admin/settings.controller');

const { protect, authorize } = require('../../middleware/auth.middleware');
const router = express.Router();

// ... (your existing router.use middleware is perfect)
router.use(protect);
router.use(authorize('admin', 'superadmin'));

router
  .route('/')
  .get(getSettings)
  .put(updateSettings);

// --- Shipping zones routes ---
router
  .route('/shipping-zones')
  .post(addShippingZone);

router
  .route('/shipping-zones/:id')
  .put(updateShippingZone)
  .delete(deleteShippingZone);

// --- NEW: Shipping rates routes (nested under zones) ---
router
  .route('/shipping-zones/:zoneId/rates')
  .post(addRateToZone);

router
  .route('/shipping-zones/:zoneId/rates/:rateId')
  .put(updateRateInZone)
  .delete(deleteRateFromZone);

// --- Payment methods routes (unchanged) ---
router
  .route('/payment-methods')
  .post(addPaymentMethod);

router
  .route('/payment-methods/:id')
  .put(updatePaymentMethod)
  .delete(deletePaymentMethod);

module.exports = router;