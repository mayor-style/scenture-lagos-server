const express = require('express');
const {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  uploadProductImages,
  deleteProductImage,
  setMainProductImage,
  generateSKU
} = require('../../controllers/admin/products.controller');

const { protect, authorize } = require('../../middleware/auth.middleware');
const { upload } = require('../../middleware/upload.middleware');

const router = express.Router();

// Apply protection and authorization to all routes
router.use(protect);
router.use(authorize('admin', 'superadmin'));



router.route('/sku')
  .get(generateSKU)

  router.route('/')
  .get(getProducts)
  .post(createProduct);

router
  .route('/:id')
  .get(getProduct)
  .put(updateProduct)
  .delete(deleteProduct);

// Image upload routes
router
  .route('/:id/images')
  .post(upload.array('images', 5), uploadProductImages);

router
  .route('/:id/images/:imageId')
  .delete(deleteProductImage);

router
  .route('/:id/images/:imageId/main')
  .put(setMainProductImage);
module.exports = router;