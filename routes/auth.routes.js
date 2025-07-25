const express = require('express');
const {
  login,
  adminLogin,
  register,
  getMe,
  updateDetails,
  updatePassword,
  logout,
  forgotPassword,
  resetPassword,
  verifyResetToken
} = require('../controllers/auth.controller');

const { protect } = require('../middleware/auth.middleware');

const router = express.Router();

// Public routes
router.post('/login', login);
router.post('/admin/login', adminLogin);
router.post('/register', register);
router.post('/forgotpassword', forgotPassword);
router.get('/resetpassword/:resettoken', verifyResetToken);
router.put('/resetpassword/:resettoken', resetPassword);

// Protected routes
router.get('/me', protect, getMe);
router.put('/updatedetails', protect, updateDetails);
router.put('/updatepassword', protect, updatePassword);
router.get('/logout', protect, logout);

module.exports = router;