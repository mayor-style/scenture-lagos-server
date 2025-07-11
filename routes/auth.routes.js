const express = require('express');
const {
  login,
  adminLogin,
  getMe,
  updateDetails,
  updatePassword,
  logout
} = require('../controllers/auth.controller');

const { protect } = require('../middleware/auth.middleware');

const router = express.Router();

// Public routes
router.post('/login', login);
router.post('/admin/login', adminLogin);

// Protected routes
router.get('/me', protect, getMe);
router.put('/updatedetails', protect, updateDetails);
router.put('/updatepassword', protect, updatePassword);
router.get('/logout', protect, logout);

module.exports = router;