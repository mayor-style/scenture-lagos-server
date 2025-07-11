const express = require('express');
const {
  getCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory
} = require('../../controllers/admin/categories.controller');

const { protect, authorize } = require('../../middleware/auth.middleware');
const { upload } = require('../../middleware/upload.middleware');

const router = express.Router();

// Apply protection and authorization to all routes
router.use(protect);
router.use(authorize('admin', 'superadmin'));

router
  .route('/')
  .get(getCategories)
  .post(upload.single('image'), createCategory);

router
  .route('/:id')
  .get(getCategory)
  .put(upload.single('image'), updateCategory)
  .delete(deleteCategory);

module.exports = router;