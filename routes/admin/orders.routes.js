const express = require('express');
const {
  getOrders,
  getOrder,
  updateOrderStatus,
  addOrderNote,
  processRefund,
  sendOrderEmail
} = require('../../controllers/admin/orders.controller');

const { protect, authorize } = require('../../middleware/auth.middleware');

const router = express.Router();

router.use(protect);
router.use(authorize('admin', 'superadmin'));

router
  .route('/')
  .get(getOrders);

router
  .route('/:id')
  .get(getOrder);

router
  .route('/:id/status')
  .put(updateOrderStatus);

router
  .route('/:id/notes')
  .post(addOrderNote);

router
  .route('/:id/refund')
  .post(processRefund);

router
  .route('/:id/email')
  .post(sendOrderEmail);

module.exports = router;