const express = require('express');
const {
  getDashboardSummary,
  getRecentOrders,
  getActivityFeed,
  getSalesData
} = require('../../controllers/admin/dashboard.controller');

const { protect, authorize } = require('../../middleware/auth.middleware');

const router = express.Router();

// Apply protection and authorization to all routes
 router.use(protect);
 router.use(authorize('admin', 'superadmin'));

router.get('/summary', getDashboardSummary);
router.get('/recent-orders', getRecentOrders);
router.get('/activity-feed', getActivityFeed);
router.get('/sales-data', getSalesData);

module.exports = router;