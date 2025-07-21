// File: src/controllers/admin/products.controller.js
const Product = require('../../models/product.model');
const Category = require('../../models/category.model');
const { ErrorResponse } = require('../../middleware/error.middleware');
const cloudinary = require('../../config/cloudinary')
const fs = require('fs').promises;
const path = require('path');
const { success, paginate } = require('../../utils/response.util');


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

    // Validate required fields
    if (!name || !price || !stockQuantity || !category || !description) {
      return next(new ErrorResponse('Missing required fields: name, price, stockQuantity, category, or description', 400));
    }

    // Validate category
    const categoryDoc = await Category.findById(category);
    if (!categoryDoc) {
      return next(new ErrorResponse(`Category not found with id of ${category}`, 404));
    }

    // Check for duplicate product name in the same category
    const existingProduct = await Product.findOne({ name, category });
    if (existingProduct) {
      return next(new ErrorResponse('Product name already exists in this category', 400));
    }

    // Generate SKU if not provided
    let finalSku = sku;
    if (!finalSku) {
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

    // Validate SKU uniqueness
    const existingSku = await Product.findOne({ sku: finalSku });
    if (existingSku) {
      return next(new ErrorResponse(`SKU ${finalSku} already exists`, 400));
    }

    // Validate and format variants
    let formattedVariants = [];
    if (variants) {
      if (!Array.isArray(variants)) {
        return next(new ErrorResponse('Variants must be an array', 400));
      }
      formattedVariants = variants.map((variant, index) => {
        if (!variant.size || !variant.stockQuantity || !variant.scentIntensity || !variant.sku) {
          return next(new ErrorResponse(`Invalid variant at index ${index}: size, stockQuantity, scentIntensity, and sku are required`, 400));
        }
        return {
          ...variant,
          sku: variant.sku, // Use provided SKU (from generateVariantSKU)
          priceAdjustment: variant.priceAdjustment || 0,
          isDefault: variant.isDefault || false,
        };
      });

      // Check for duplicate variant SKUs
      const variantSkus = formattedVariants.map((v) => v.sku);
      const uniqueVariantSkus = new Set(variantSkus);
      if (uniqueVariantSkus.size !== variantSkus.length) {
        return next(new ErrorResponse('Duplicate variant SKUs within the product', 400));
      }

      const existingVariantSkus = await Product.findOne({ 'variants.sku': { $in: variantSkus } });
      if (existingVariantSkus) {
        return next(new ErrorResponse('One or more variant SKUs already exist in another product', 400));
      }
    }

    // Skip image validation (images are uploaded separately via uploadProductImages)

    // Validate price and stock quantities
    if (price < 0) {
      return next(new ErrorResponse('Price must be greater than or equal to 0', 400));
    }
    if (stockQuantity < 0) {
      return next(new ErrorResponse('Stock quantity cannot be negative', 400));
    }

    // Validate status
    if (status && !['draft', 'published', 'archived'].includes(status)) {
      return next(new ErrorResponse('Invalid status value', 400));
    }

    // Validate scent notes
    if (scentNotes) {
      const { top, middle, base } = scentNotes;
      if (
        (top && !Array.isArray(top)) ||
        (middle && !Array.isArray(middle)) ||
        (base && !Array.isArray(base))
      ) {
        return next(new ErrorResponse('Scent notes must be arrays', 400));
      }
    }

    // Validate ingredients
    if (ingredients && !Array.isArray(ingredients)) {
      return next(new ErrorResponse('Ingredients must be an array', 400));
    }

    // Create product
    const product = new Product({
      name,
      sku: finalSku,
      price,
      stockQuantity,
      status: status || 'draft',
      category,
      description,
      scentNotes,
      ingredients,
      variants: formattedVariants,
      images: [], // Initialize empty (images added later)
      createdBy: req.user._id,
      updatedAt: Date.now(),
    });

    await product.save();

    // Populate category for response
    const populatedProduct = await Product.findById(product._id)
      .populate('category', 'name slug')
      .populate('createdBy', 'name');

    return success(res, 'Product created successfully', { product: populatedProduct });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map((val) => val.message);
      return next(new ErrorResponse(messages.join(', '), 400));
    }
    return next(new ErrorResponse(err.message || 'Server error', 500));
  }
};

exports.updateProduct = async (req, res, next) => {
  try {
    // Find product by ID
    const product = await Product.findById(req.params.id);
    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    // Set updatedBy to current user
    req.body.updatedBy = req.user.id;

    // Validate SKU uniqueness if changed
    if (req.body.sku && req.body.sku !== product.sku) {
      const existingSku = await Product.findOne({
        sku: req.body.sku,
        _id: { $ne: req.params.id },
      });
      if (existingSku) {
        return next(new ErrorResponse('SKU already exists', 400));
      }
    }

    if (req.body.name && req.body.name !== product.name) {
  const existingProduct = await Product.findOne({
    name: req.body.name,
    category: req.body.category || product.category,
    _id: { $ne: req.params.id },
  });
  if (existingProduct) {
    return next(new ErrorResponse('Product name already exists in this category', 400));
  }
}

    // Validate category if provided
    if (req.body.category) {
      const category = await Category.findById(req.body.category);
      if (!category) {
        return next(new ErrorResponse(`Category not found with id of ${req.body.category}`, 404));
      }
    }

    // Validate and format variants
    let formattedVariants = product.variants;
    if (req.body.variants) {
      if (!Array.isArray(req.body.variants)) {
        return next(new ErrorResponse('Variants must be an array', 400));
      }

      formattedVariants = req.body.variants.map((variant, index) => {
        if (!variant.size || !variant.stockQuantity || !variant.scentIntensity) {
          return next(new ErrorResponse(`Invalid variant at index ${index}: size, stockQuantity, and scentIntensity are required`, 400));
        }
        return {
          ...variant,
          sku: `${req.body.sku || product.sku}-${variant.size.toLowerCase().replace(/\s+/g, '-')}`,
          priceAdjustment: variant.priceAdjustment || 0,
          isDefault: variant.isDefault || false,
        };
      });

      // Check for duplicate variant SKUs within the product and across other products
      const variantSkus = formattedVariants.map((v) => v.sku);
      const uniqueVariantSkus = new Set(variantSkus);
      if (uniqueVariantSkus.size !== variantSkus.length) {
        return next(new ErrorResponse('Duplicate variant SKUs within the product', 400));
      }

      const existingVariantSkus = await Product.findOne({
        _id: { $ne: req.params.id },
        'variants.sku': { $in: variantSkus },
      });
      if (existingVariantSkus) {
        return next(new ErrorResponse('One or more variant SKUs already exist in another product', 400));
      }
    }

    // Validate images
    if (req.body.images) {
      if (!Array.isArray(req.body.images)) {
        return next(new ErrorResponse('Images must be an array', 400));
      }
      const hasMainImage = req.body.images.some((img) => img.isMain);
      if (!hasMainImage && req.body.images.length > 0) {
        return next(new ErrorResponse('At least one image must be marked as main', 400));
      }
      req.body.images = req.body.images.map((img) => ({
        url: img.url,
        public_id: img.public_id, // Include public_id
        isMain: img.isMain || false,
        alt: img.alt || '',
      }));
    }

    // Validate price and stock quantities
    if (req.body.price && req.body.price < 0) {
      return next(new ErrorResponse('Price must be greater than or equal to 0', 400));
    }
    if (req.body.stockQuantity && req.body.stockQuantity < 0) {
      return next(new ErrorResponse('Stock quantity cannot be negative', 400));
    }
    if (req.body.reorderPoint && req.body.reorderPoint < 0) {
      return next(new ErrorResponse('Reorder point cannot be negative', 400));
    }

    // Validate status
    if (req.body.status && !['draft', 'published', 'archived'].includes(req.body.status)) {
      return next(new ErrorResponse('Invalid status value', 400));
    }

    // Validate scent notes
    if (req.body.scentNotes) {
      const { top, middle, base } = req.body.scentNotes;
      if (
        (top && !Array.isArray(top)) ||
        (middle && !Array.isArray(middle)) ||
        (base && !Array.isArray(base))
      ) {
        return next(new ErrorResponse('Scent notes must be arrays', 400));
      }
    }

    // Validate ingredients
    if (req.body.ingredients && !Array.isArray(req.body.ingredients)) {
      return next(new ErrorResponse('Ingredients must be an array', 400));
    }

    // Validate averageRating and numReviews
    if (req.body.averageRating && (req.body.averageRating < 1 || req.body.averageRating > 5)) {
      return next(new ErrorResponse('Average rating must be between 1 and 5', 400));
    }
    if (req.body.numReviews && req.body.numReviews < 0) {
      return next(new ErrorResponse('Number of reviews cannot be negative', 400));
    }

    // Prepare update data
    const updateData = {
      ...req.body,
      variants: formattedVariants,
      updatedAt: Date.now(),
    };

    // Update product
    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true,
        runValidators: true,
        context: 'query',
      }
    )
      .populate('category', 'name slug')
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name');

    if (!updatedProduct) {
      return next(new ErrorResponse('Failed to update product', 500));
    }

    // Check low stock status
    const isLowStock = await updatedProduct.isLowStock();
    if (isLowStock) {
      // Optionally trigger a notification or log for low stock
      console.log(`Product ${updatedProduct.name} is low on stock`);
    }

    return success(res, 'Product updated successfully', { product: updatedProduct });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map((val) => val.message);
      return next(new ErrorResponse(messages.join(', '), 400));
    }
    return next(new ErrorResponse(err.message || 'Server error', 500));
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
      return next(new ErrorResponse('Product not found', 404));
    }

    if (!req.files || req.files.length === 0) {
      return next(new ErrorResponse('No files uploaded', 400));
    }

    const uploadedImages = [];
    for (const file of req.files) {
      const filePath = path.join(__dirname, '../../public/uploads', file.filename);

      // Verify file exists
      try {
        await fs.access(filePath);
      } catch (err) {
        console.error(`File not found: ${filePath}`);
        return next(new ErrorResponse(`File not found: ${file.filename}`, 400));
      }

      // Upload to Cloudinary with error handling
      try {
        const result = await cloudinary.uploader.upload(filePath, {
          folder: 'scenture/products',
          use_filename: true,
          unique_filename: false,
          timeout: 60000, // Set timeout to 60 seconds
        });

        uploadedImages.push({
          url: result.secure_url,
          public_id: result.public_id,
          isMain: product.images.length === 0 && uploadedImages.length === 0,
          alt: file.originalname || '',
        });

        // Clean up file after successful upload
        try {
          await fs.unlink(filePath);
        } catch (err) {
          console.error(`Failed to delete file ${filePath}:`, err);
        }
      } catch (cloudinaryErr) {
        console.error(`Cloudinary upload error for ${filePath}:`, cloudinaryErr);
        // Clean up file on error to prevent orphaned files
        try {
          await fs.unlink(filePath);
        } catch (unlinkErr) {
          console.error(`Failed to delete file ${filePath} after Cloudinary error:`, unlinkErr);
        }
        return next(new ErrorResponse(`Failed to upload image to Cloudinary: ${cloudinaryErr.message}`, 500));
      }
    }

    // Update product with new images
    product.images = [...product.images, ...uploadedImages];
    await product.save();

    // Populate category for response
    const populatedProduct = await Product.findById(product._id)
      .populate('category', 'name slug')
      .populate('createdBy', 'name');

    return success(res, 'Images uploaded successfully', { product: populatedProduct });
  } catch (err) {
    console.error('Upload images error:', err);
    // Clean up any remaining files on general error
    if (req.files) {
      for (const file of req.files) {
        try {
          await fs.unlink(path.join(__dirname, '../../public/uploads', file.filename));
        } catch (unlinkErr) {
          console.error(`Failed to delete file ${file.filename}:`, unlinkErr);
        }
      }
    }
    return next(new ErrorResponse(`Failed to upload images: ${err.message}`, 500));
  }
};

exports.deleteProductImage = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    const imageIndex = product.images.findIndex(
      (image) => image._id.toString() === req.params.imageId
    );

    if (imageIndex === -1) {
      return next(new ErrorResponse(`Image not found with id of ${req.params.imageId}`, 404));
    }

    const image = product.images[imageIndex];

    // Delete image from Cloudinary
    if (image.public_id) {
      try {
        await cloudinary.uploader.destroy(image.public_id);
      } catch (error) {
        return next(new ErrorResponse(`Failed to delete image from Cloudinary: ${error.message}`, 500));
      }
    }

    const isMain = image.isMain;

    // Remove image from product
    product.images.splice(imageIndex, 1);

    // Set new main image if necessary
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

exports.generateVariantSKU = async (req, res) => {
  try {
    const { productSKU, size } = req.body;
    if (!productSKU || !size) {
      return res.status(400).json({ error: 'Product SKU and variant size are required' });
    }
    const sanitizedSize = size.replace(/\s+/g, '-').toUpperCase();
    const variantSKU = `${productSKU}-${sanitizedSize}`;
    const existingProduct = await Product.findOne({ 'variants.sku': variantSKU });
    if (existingProduct) {
      return res.status(400).json({ error: `Variant SKU ${variantSKU} already exists` });
    }
    res.status(200).json({ sku: variantSKU });
  } catch (error) {
    console.error('Generate variant SKU error:', error);
    res.status(500).json({ error: 'Failed to generate variant SKU' });
  }
};