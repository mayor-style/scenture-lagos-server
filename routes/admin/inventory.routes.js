const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../../middleware/auth.middleware');
const {
  getInventory,
  getLowStockProducts,
  getOutOfStockProducts,
  adjustStock,
  getStockHistory,
  generateInventoryReport,
  exportInventoryCSV,
  getInventoryItem,
} = require('../../controllers/admin/inventory.controller');

router.use(protect);
router.use(authorize('admin', 'superadmin'));

router.route('/').get(getInventory);
router.route('/low-stock').get(getLowStockProducts);
router.route('/out-of-stock').get(getOutOfStockProducts);
router.route('/:id').get(getInventoryItem);
router.route('/:id/adjust').put(adjustStock);
router.route('/:id/history').get(getStockHistory);
router.route('/report').get(generateInventoryReport);
router.route('/export').get(exportInventoryCSV);

module.exports = router;