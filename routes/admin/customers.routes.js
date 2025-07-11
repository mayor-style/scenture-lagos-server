const express = require('express');
const {
  getCustomers,
  createCustomer,
  getCustomer,
  updateCustomer,
  getCustomerOrders,
  addCustomerNote,
  getCustomerNotes,
  deleteCustomerNote,
  getCustomerReviews,
  updateCustomerVip,
  updateCustomerFlag,
  deactivateCustomer,
} = require('../../controllers/admin/customers.controller');

const { protect, authorize } = require('../../middleware/auth.middleware');

const router = express.Router();

router.use(protect);
router.use(authorize('admin', 'superadmin'));

router
  .route('/')
  .get(getCustomers)
  .post(createCustomer);

router
  .route('/:id')
  .get(getCustomer)
  .put(updateCustomer);

router
  .route('/:id/orders')
  .get(getCustomerOrders);

router
  .route('/:id/notes')
  .get(getCustomerNotes)
  .post(addCustomerNote);

router
  .route('/:id/notes/:noteId')
  .delete(deleteCustomerNote);

router
  .route('/:id/reviews')
  .get(getCustomerReviews);

router
  .route('/:id/vip')
  .put(updateCustomerVip);

router
  .route('/:id/flag')
  .put(updateCustomerFlag);

router
  .route('/:id/deactivate')
  .put(deactivateCustomer);

module.exports = router;