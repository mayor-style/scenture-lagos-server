const express = require('express');
const router = express.Router();
const { submitContactForm } = require('../controllers/contact.controller');

// Public routes
router.post('/', submitContactForm);

module.exports = router;