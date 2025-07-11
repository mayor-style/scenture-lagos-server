const express = require('express');
const {
  register,
  getProfile,
  updateProfile,
  getOrders,
  getOrder,
  getRecentlyViewed,
  addToRecentlyViewed,
  getWishlist,
  addToWishlist,
  removeFromWishlist
} = require('../controllers/customer.controller');

const { protect, authorize } = require('../middleware/auth.middleware');

const router = express.Router();

// Public routes
router.post('/register', register);

// Protected customer routes
router.use(protect);
router.use(authorize('customer'));

// Profile routes
router.get('/profile', getProfile);
router.put('/profile', updateProfile);

// Order routes
router.get('/orders', getOrders);
router.get('/orders/:id', getOrder);

// Recently viewed routes
router.get('/recently-viewed', getRecentlyViewed);
router.post('/recently-viewed', addToRecentlyViewed);

// Wishlist routes
router.get('/wishlist', getWishlist);
router.post('/wishlist', addToWishlist);
router.delete('/wishlist/:id', removeFromWishlist);

module.exports = router;