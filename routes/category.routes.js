const express = require('express');
const {
  getCategories,
  getCategory,
  getFeaturedCategories
} = require('../controllers/category.controller');

const router = express.Router();

// All routes are public
router.get('/', getCategories);
router.get('/featured', getFeaturedCategories);
router.get('/:slug', getCategory);

module.exports = router;