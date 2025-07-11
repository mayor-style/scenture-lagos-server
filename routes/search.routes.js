const express = require('express');
const router = express.Router();
const {
  searchProducts,
  getSearchSuggestions
} = require('../controllers/search.controller');

// Public routes
router.get('/', searchProducts);
router.get('/suggestions', getSearchSuggestions);

module.exports = router;