const express = require('express');
const {
  addToCart,
  getCart,
  updateCartItem,
  removeCartItem,
  clearCart,
  applyCoupon,
  removeCoupon,
} = require('../controllers/cart.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = express.Router();

// Public routes (accessible to guests and authenticated users)
router.route('/').get(getCart).post(addToCart).delete(clearCart);
router.route('/:itemId').put(updateCartItem).delete(removeCartItem);

// Protected routes (require authentication)
router.route('/coupon').post(protect, authorize('customer'), applyCoupon).delete(protect, authorize('customer'), removeCoupon);

module.exports = router;