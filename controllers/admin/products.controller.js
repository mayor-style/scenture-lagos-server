// File: src/controllers/admin/products.controller.js
const Product = require('../../models/product.model');
const Category = require('../../models/category.model');
const { ErrorResponse } = require('../../middleware/error.middleware');
const { success, paginate } = require('../../utils/response.util');
const { upload } = require('../../middleware/upload.middleware');

const SKU_PREFIXES = {
  'Candles': 'CAN',
  'Room Sprays': 'RSP',
  'Diffusers': 'DIF',
  'Gift Sets': 'GFT'
};

exports.getProducts = async (req, res, next) => {
  console.log('hit get all products')
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;

    const filter = {};

    if (req.query.status && ['draft', 'published', 'archived'].includes(req.query.status)) {
      filter.status = req.query.status;
    }

    if (req.query.category) {
      filter.category = req.query.category;
    }

    if (req.query.featured) {
      filter.featured = req.query.featured === 'true';
    }

    if (req.query.stock) {
      if (req.query.stock === 'in_stock') {
        filter.stockQuantity = { $gt: 0 };
      } else if (req.query.stock === 'out_of_stock') {
        filter.stockQuantity = 0;
      } else if (req.query.stock === 'low_stock') {
        filter.stockQuantity = { $gt: 0, $lte: 10 };
      }
    }

    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      filter.$or = [
        { name: searchRegex },
        { sku: searchRegex },
        { 'variants.sku': searchRegex }
      ];
    }

    const total = await Product.countDocuments(filter);
    const products = await Product.find(filter)
      .populate('category', 'name')
      .sort(req.query.sort || '-createdAt')
      .skip(startIndex)
      .limit(limit);

    const formattedProducts = products.map(product => ({
      id: product._id,
      name: product.name,
      sku: product.sku,
      price: product.price,
      stock: product.stockQuantity,
      stockStatus: product.stockQuantity > 10 ? 'Active' : product.stockQuantity === 0 ? 'Out of Stock' : 'Low Stock',
      categoryName: product.category ? product.category.name : 'Uncategorized',
      status: product.status,
      images: product.images || [],
      variants: product.variants || []
    }));

    return paginate(
      res,
      'Products retrieved successfully',
      formattedProducts,
      page,
      limit,
      total
    );
  } catch (err) {
    next(err);
  }
};

exports.getProduct = async (req, res, next) => {
  console.log('hit get product')
  try {
    const product = await Product.findById(req.params.id).populate('category', 'name');

    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    const formattedProduct = {
      id: product._id,
      name: product.name,
      sku: product.sku,
      price: product.price,
      stock: product.stockQuantity,
      status: product.status,
      category: product.category ? product.category.name : 'Uncategorized',
      categoryId: product.category ? product.category._id : null,
      description: product.description || '',
      scent_notes: [
        ...(product.scentNotes?.top || []),
        ...(product.scentNotes?.middle || []),
        ...(product.scentNotes?.base || [])
      ],
      ingredients: product.ingredients ? product.ingredients.join(', ') : '',
      variants: product.variants || [],
      images: product.images || []
    };

    return success(res, 'Product retrieved successfully', { product: formattedProduct });
  } catch (err) {
    next(err);
  }
};

exports.createProduct = async (req, res, next) => {
  try {
    const { name, sku, price, stockQuantity, status, category, description, scentNotes, ingredients, variants } = req.body;

    let finalSku = sku;
    if (!finalSku) {
      const categoryDoc = await Category.findById(category);
      if (!categoryDoc) {
        return next(new ErrorResponse(`Category not found with id of ${category}`, 404));
      }
      // Generate SKU prefix from category name (e.g., "Lavender Candles" -> "LAV")
      const prefix = categoryDoc.name
        .split(' ')
        .map(word => word.charAt(0).toUpperCase())
        .join('')
        .slice(0, 3)
        .toUpperCase();
      const lastProduct = await Product.findOne({ sku: new RegExp(`^${prefix}-`) })
        .sort({ sku: -1 })
        .select('sku');
      const lastNumber = lastProduct ? parseInt(lastProduct.sku.split('-')[1]) || 0 : 0;
      finalSku = `${prefix}-${String(lastNumber + 1).padStart(3, '0')}`;
    }

    const existingProduct = await Product.findOne({ sku: finalSku });
    if (existingProduct) {
      return next(new ErrorResponse(`SKU ${finalSku} already exists`, 400));
    }

    const formattedVariants = variants ? variants.map(variant => ({
      ...variant,
      sku: `${finalSku}-${variant.size.toLowerCase().replace(/\s+/g, '-')}`
    })) : [];

    const existingVariantSkus = await Product.findOne({ 'variants.sku': { $in: formattedVariants.map(v => v.sku) } });
    if (existingVariantSkus) {
      return next(new ErrorResponse('Variant SKU already exists', 400));
    }

    const product = new Product({
      name,
      sku: finalSku,
      price,
      stockQuantity,
      status,
      category,
      description,
      scentNotes,
      ingredients,
      variants: formattedVariants,
      createdBy: req.user._id
    });

    await product.save();
    return success(res, 'Product created successfully', { product });
  } catch (err) {
    console.error('Error creating product:', err);
    next(err);
  }
};
exports.updateProduct = async (req, res, next) => {
  try {
    let product = await Product.findById(req.params.id);

    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    req.body.updatedBy = req.user.id;

    if (req.body.sku && req.body.sku !== product.sku) {
      const existingSku = await Product.findOne({ sku: req.body.sku });
      if (existingSku) {
        return next(new ErrorResponse('SKU already exists', 400));
      }
    }

    const formattedVariants = req.body.variants ? req.body.variants.map(variant => ({
      ...variant,
      sku: `${req.body.sku || product.sku}-${variant.size.toLowerCase().replace(/\s+/g, '-')}`
    })) : product.variants;

    const existingVariantSkus = await Product.findOne({
      _id: { $ne: req.params.id },
      'variants.sku': { $in: formattedVariants.map(v => v.sku) }
    });
    if (existingVariantSkus) {
      return next(new ErrorResponse('Variant SKU already exists', 400));
    }

    req.body.variants = formattedVariants;

    product = await Product.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    }).populate('category', 'name');

    return success(res, 'Product updated successfully', { product });
  } catch (err) {
    next(err);
  }
};

exports.deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    await product.deleteOne();

    return success(res, 'Product deleted successfully');
  } catch (err) {
    next(err);
  }
};

exports.uploadProductImages = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    if (!req.files || req.files.length === 0) {
      return next(new ErrorResponse('Please upload at least one image', 400));
    }

    const images = req.files.map(file => ({
      url: `/uploads/${file.filename}`,
      isMain: false,
      alt: product.name
    }));

    if (product.images.length === 0 && images.length > 0) {
      images[0].isMain = true;
    }

    product.images = [...product.images, ...images];
    product.updatedBy = req.user.id;

    await product.save();

    return success(res, 'Product images uploaded successfully', { product });
  } catch (err) {
    next(err);
  }
};

exports.deleteProductImage = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    const imageIndex = product.images.findIndex(
      image => image._id.toString() === req.params.imageId
    );

    if (imageIndex === -1) {
      return next(new ErrorResponse(`Image not found with id of ${req.params.imageId}`, 404));
    }

    const isMain = product.images[imageIndex].isMain;

    product.images.splice(imageIndex, 1);

    if (isMain && product.images.length > 0) {
      product.images[0].isMain = true;
    }

    product.updatedBy = req.user.id;

    await product.save();

    return success(res, 'Product image deleted successfully', { product });
  } catch (err) {
    next(err);
  }
};

exports.setMainProductImage = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    const imageIndex = product.images.findIndex(
      image => image._id.toString() === req.params.imageId
    );

    if (imageIndex === -1) {
      return next(new ErrorResponse(`Image not found with id of ${req.params.imageId}`, 404));
    }

    product.images.forEach(image => {
      image.isMain = false;
    });

    product.images[imageIndex].isMain = true;
    product.updatedBy = req.user.id;

    await product.save();

    return success(res, 'Main product image set successfully', { product });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Generate a unique SKU for a product
 * @route   GET /api/v1/admin/products/sku
 * @access  Private/Admin
 */
exports.generateSKU = async (req, res, next) => {
  console.log('hit generate sku')
  try {
    const { categoryId } = req.query;
    if (!categoryId) {
      return next(new ErrorResponse('Category ID is required', 400));
    }

    const category = await Category.findById(categoryId);
    if (!category) {
      return next(new ErrorResponse(`Category not found with id of ${categoryId}`, 404));
    }

    // Generate SKU prefix from category name (e.g., "Lavender Candles" -> "LAV")
    const prefix = category.name
      .split(' ')
      .map(word => word.charAt(0).toUpperCase())
      .join('')
      .slice(0, 3)
      .toUpperCase();

    // Find the last product with this prefix and get the next sequence number
    const lastProduct = await Product.findOne({ sku: new RegExp(`^${prefix}-`) })
      .sort({ sku: -1 })
      .select('sku');
    const lastNumber = lastProduct ? parseInt(lastProduct.sku.split('-')[1]) || 0 : 0;
    const newSku = `${prefix}-${String(lastNumber + 1).padStart(3, '0')}`;

    return success(res, 'SKU generated successfully', { sku: newSku });
  } catch (err) {
    console.error('Error generating SKU:', err);
    next(err);
  }
};