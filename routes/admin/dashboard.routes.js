const express = require('express');
const {
  getDashboardSummary,
  getRecentOrders,
  getActivityFeed
} = require('../../controllers/admin/dashboard.controller');

const { protect, authorize } = require('../../middleware/auth.middleware');

const router = express.Router();

// Apply protection and authorization to all routes
 router.use(protect);
 router.use(authorize('admin', 'superadmin'));

// --- Main Dashboard Endpoints ---
router.get('/summary', getDashboardSummary);
router.get('/recent-orders', getRecentOrders);
router.get('/activity-feed', getActivityFeed);

// The '/sales-data' route has been removed as it is redundant.
// Its functionality is now handled entirely within the '/summary' endpoint.

module.exports = router;