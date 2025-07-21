const express = require('express');
const {
  getProducts,
  getProduct,
  getFeaturedProducts,
  getNewArrivals,
  getBestSellingProducts,
  getProductReviews,
  createProductReview,
} = require('../controllers/product.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = express.Router();

// Public routes
router.get('/', getProducts);
router.get('/featured', getFeaturedProducts);
router.get('/new-arrivals', getNewArrivals);
router.get('/best-selling', getBestSellingProducts);
router.get('/:slug', getProduct);
router.get('/:id/reviews', getProductReviews);

// Protected routes
router.post('/:id/reviews', protect, authorize('customer'), createProductReview);

module.exports = router;