const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../../middleware/auth.middleware');
const {
  getContactMessages,
  getContactMessage,
  updateContactMessage,
  deleteContactMessage
} = require('../../controllers/contact.controller');

// All routes require admin authentication
router.use(protect);
router.use(authorize('admin', 'superadmin'));

// Routes
router.get('/', getContactMessages);
router.get('/:id', getContactMessage);
router.put('/:id', updateContactMessage);
router.delete('/:id', deleteContactMessage);

module.exports = router;