// File: src/controllers/admin/products.controller.js
const Product = require('../../models/product.model');
const Category = require('../../models/category.model');
const { ErrorResponse } = require('../../middleware/error.middleware');
const cloudinary = require('../../config/cloudinary');
const fs = require('fs').promises;
const { success, paginate } = require('../../utils/response.util');

// #region ============================ Product Retrieval ============================

exports.getProducts = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;

    const filter = {};
    const { status, category, featured, stock, search, sort } = req.query;

    if (status && ['draft', 'published', 'archived'].includes(status)) {
      filter.status = status;
    }

    if (category) {
      filter.category = category;
    }

    if (featured) {
      filter.featured = featured === 'true';
    }

    if (stock) {
      if (stock === 'in_stock') {
        filter.stockQuantity = { $gt: 0 };
      } else if (stock === 'out_of_stock') {
        filter.stockQuantity = { $eq: 0 };
      } else if (stock === 'low_stock') {
        // This threshold (10) should ideally come from a settings model
        // but is kept here for performance in a list view.
        filter.stockQuantity = { $gt: 0, $lte: 10 };
      }
    }

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      filter.$or = [
        { name: searchRegex },
        { sku: searchRegex },
        { 'variants.sku': searchRegex },
      ];
    }

    // Run count and find queries concurrently for better performance
    const [total, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter)
        .populate('category', 'name')
        .sort(sort || '-createdAt')
        .skip(startIndex)
        .limit(limit)
        .lean() // Use .lean() for faster read-only queries
    ]);

    const formattedProducts = products.map(product => ({
      id: product._id,
      name: product.name,
      sku: product.sku,
      price: product.price,
      stock: product.stockQuantity,
      stockStatus: product.stockQuantity > 10 ? 'In Stock' : product.stockQuantity === 0 ? 'Out of Stock' : 'Low Stock',
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
  try {
    const product = await Product.findById(req.params.id).populate('category', 'name').lean();

    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    // Response structure is preserved as requested
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

// #endregion

// #region ============================ Product CUD ============================

exports.createProduct = async (req, res, next) => {
  try {
    const { name, sku, price, stockQuantity, status, category, description, scentNotes, ingredients, variants } = req.body;

    // Validate required fields
    if (!name || !price || !stockQuantity || !category || !description) {
      return next(new ErrorResponse('Missing required fields: name, price, stockQuantity, category, or description', 400));
    }

    // Perform independent validations concurrently
    const [categoryDoc, existingProductByName] = await Promise.all([
        Category.findById(category).lean(),
        Product.findOne({ name, category }).lean()
    ]);

    if (!categoryDoc) {
      return next(new ErrorResponse(`Category not found with id of ${category}`, 404));
    }
    if (existingProductByName) {
      return next(new ErrorResponse('Product name already exists in this category', 400));
    }

    // Generate SKU if not provided
    let finalSku = sku;
    if (!finalSku) {
      const prefix = categoryDoc.name.split(' ').map(word => word.charAt(0)).join('').slice(0, 3).toUpperCase();
      const lastProduct = await Product.findOne({ sku: new RegExp(`^${prefix}-`) }).sort({ createdAt: -1 }).select('sku').lean();
      const lastNumber = lastProduct ? parseInt(lastProduct.sku.split('-')[1], 10) || 0 : 0;
      finalSku = `${prefix}-${String(lastNumber + 1).padStart(3, '0')}`;
    }

    // Validate SKU uniqueness
    const existingSku = await Product.findOne({ sku: finalSku }).lean();
    if (existingSku) {
      return next(new ErrorResponse(`SKU ${finalSku} already exists`, 400));
    }

    // Validate and format variants
    let formattedVariants = [];
    if (variants) {
      if (!Array.isArray(variants)) return next(new ErrorResponse('Variants must be an array', 400));
      const variantSkus = variants.map(v => v.sku);
      
      // Check for duplicate SKUs within the request itself
      if (new Set(variantSkus).size !== variantSkus.length) {
        return next(new ErrorResponse('Duplicate variant SKUs provided', 400));
      }
      
      // Check if any of these variant SKUs already exist in the database
      const existingVariantSkus = await Product.findOne({ 'variants.sku': { $in: variantSkus } }).lean();
      if (existingVariantSkus) {
          return next(new ErrorResponse('One or more variant SKUs already exist', 400));
      }

      // Use a for...of loop to allow early exit on error
      for (const [index, variant] of variants.entries()) {
        if (!variant.size || !variant.stockQuantity || !variant.scentIntensity || !variant.sku) {
          return next(new ErrorResponse(`Variant at index ${index} is missing required fields: size, stockQuantity, scentIntensity, sku`, 400));
        }
        formattedVariants.push({
          ...variant,
          priceAdjustment: variant.priceAdjustment || 0,
          isDefault: variant.isDefault || false,
        });
      }
    }
    
    // Create product instance
    const product = new Product({
      ...req.body,
      sku: finalSku,
      status: status || 'draft',
      variants: formattedVariants,
      images: [], // Initialize empty, images are uploaded via a separate endpoint
      createdBy: req.user._id,
    });

    const newProduct = await product.save();
    
    // Populate the new document without a second DB call
    await newProduct.populate([
        { path: 'category', select: 'name slug' },
        { path: 'createdBy', select: 'name' }
    ]);

    return success(res, 'Product created successfully', { product: newProduct }, 201);
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map((val) => val.message);
      return next(new ErrorResponse(messages.join(', '), 400));
    }
    next(err);
  }
};

exports.updateProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    const { sku, name, category, variants, images } = req.body;

    // Validate uniqueness constraints if fields are being changed
    if (sku && sku !== product.sku) {
      const existingSku = await Product.findOne({ sku, _id: { $ne: product._id } });
      if (existingSku) return next(new ErrorResponse('SKU already exists', 400));
    }
    if (name && name !== product.name) {
      const existingProduct = await Product.findOne({ name, category: category || product.category, _id: { $ne: product._id } });
      if (existingProduct) return next(new ErrorResponse('Product name already exists in this category', 400));
    }
    if (category) {
        const categoryDoc = await Category.findById(category).lean();
        if (!categoryDoc) return next(new ErrorResponse(`Category not found with id of ${category}`, 404));
    }

    // Validate and format variants if provided
    if (variants) {
      if (!Array.isArray(variants)) return next(new ErrorResponse('Variants must be an array', 400));
      
      const variantSkus = variants.map(v => v.sku);
      if (new Set(variantSkus).size !== variantSkus.length) {
          return next(new ErrorResponse('Duplicate variant SKUs within the product', 400));
      }

      const existingVariantSkus = await Product.findOne({ _id: { $ne: product._id }, 'variants.sku': { $in: variantSkus } });
      if (existingVariantSkus) {
          return next(new ErrorResponse('One or more variant SKUs already exist in another product', 400));
      }

      // Use for...of to correctly handle async validation and errors
      for (const [index, variant] of variants.entries()) {
        if (!variant.size || !variant.stockQuantity || !variant.scentIntensity || !variant.sku) {
          return next(new ErrorResponse(`Invalid variant at index ${index}: size, stockQuantity, scentIntensity, and sku are required`, 400));
        }
      }
      req.body.variants = variants;
    }

    // Validate images array structure
    if (images) {
      if (!Array.isArray(images)) return next(new ErrorResponse('Images must be an array', 400));
      if (images.length > 0 && !images.some(img => img.isMain)) {
          return next(new ErrorResponse('At least one image must be marked as main', 400));
      }
    }
    
    // Prepare update data
    const updateData = {
      ...req.body,
      updatedBy: req.user.id,
      updatedAt: Date.now(),
    };

    const updatedProduct = await Product.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
      context: 'query',
    }).populate([
        { path: 'category', select: 'name slug' },
        { path: 'createdBy', select: 'name' },
        { path: 'updatedBy', select: 'name' }
    ]);

    return success(res, 'Product updated successfully', { product: updatedProduct });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map((val) => val.message);
      return next(new ErrorResponse(messages.join(', '), 400));
    }
    next(err);
  }
};

exports.deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    // CRITICAL FIX: Delete associated images from Cloudinary
    if (product.images && product.images.length > 0) {
      const publicIds = product.images.map(image => image.public_id);
      // Use Promise.all to delete all images concurrently
      await Promise.all(
        publicIds.map(publicId => cloudinary.uploader.destroy(publicId))
      );
    }
    
    await product.deleteOne();

    return success(res, 'Product deleted successfully', null, 204); // 204 No Content for successful deletion
  } catch (err) {
    next(err);
  }
};

// #endregion

// #region ============================ Image Management ============================

exports.uploadProductImages = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return next(new ErrorResponse('Product not found', 404));
    if (!req.files || req.files.length === 0) return next(new ErrorResponse('No files uploaded', 400));

    // Determine if a new main image needs to be set
    const hasMainImageAlready = product.images.some(img => img.isMain);
    const uploadedImages = [];

    // Process files serially to avoid race conditions and overwhelming services
    for (const [index, file] of req.files.entries()) {
      const filePath = file.path; // Multer provides the full path
      try {
        const result = await cloudinary.uploader.upload(filePath, {
          folder: 'scenture/products',
          use_filename: true,
          unique_filename: false,
          timeout: 60000,
        });

        uploadedImages.push({
          url: result.secure_url,
          public_id: result.public_id,
          alt: file.originalname || product.name,
          // Set the first uploaded image as main ONLY if no main image exists
          isMain: !hasMainImageAlready && index === 0,
        });

      } catch (cloudinaryErr) {
        console.error(`Cloudinary upload error for ${filePath}:`, cloudinaryErr);
        // Stop processing and return an error if one upload fails
        return next(new ErrorResponse(`Failed to upload image: ${cloudinaryErr.message}`, 500));
      } finally {
        // Clean up the local file regardless of upload success or failure
        await fs.unlink(filePath).catch(err => console.error(`Failed to delete temp file ${filePath}:`, err));
      }
    }

    product.images.push(...uploadedImages);
    await product.save();

    await product.populate([
        { path: 'category', select: 'name slug' },
        { path: 'createdBy', select: 'name' }
    ]);
    
    return success(res, 'Images uploaded successfully', { product });
  } catch (err) {
    // General error handling
    next(err);
  }
};

exports.deleteProductImage = async (req, res, next) => {
  try {
    const { id, imageId } = req.params;
    const product = await Product.findById(id);

    if (!product) return next(new ErrorResponse(`Product not found with id of ${id}`, 404));

    const image = product.images.id(imageId);
    if (!image) return next(new ErrorResponse(`Image not found with id of ${imageId}`, 404));
    
    // Delete image from Cloudinary
    if (image.public_id) {
        await cloudinary.uploader.destroy(image.public_id);
    }

    const wasMainImage = image.isMain;
    image.remove(); // Use Mongoose sub-document remove method

    // If the deleted image was the main one, and there are other images left,
    // set the first remaining image as the new main image.
    if (wasMainImage && product.images.length > 0) {
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
    const { id, imageId } = req.params;
    const product = await Product.findById(id);

    if (!product) return next(new ErrorResponse(`Product not found with id of ${id}`, 404));

    const imageToSetAsMain = product.images.id(imageId);
    if (!imageToSetAsMain) return next(new ErrorResponse(`Image not found with id of ${imageId}`, 404));

    // Unset the current main image
    product.images.forEach(img => {
      if (img.isMain) img.isMain = false;
    });

    // Set the new main image
    imageToSetAsMain.isMain = true;
    product.updatedBy = req.user.id;
    await product.save();

    return success(res, 'Main product image set successfully', { product });
  } catch (err) {
    next(err);
  }
};

// #endregion

// #region ============================ SKU Generation ============================

exports.generateSKU = async (req, res, next) => {
  try {
    const { categoryId } = req.query;
    if (!categoryId) return next(new ErrorResponse('Category ID is required', 400));

    const category = await Category.findById(categoryId).lean();
    if (!category) return next(new ErrorResponse(`Category not found with id of ${categoryId}`, 404));

    // Generate SKU prefix from category name (e.g., "Lavender Candles" -> "LC")
    const prefix = category.name.split(' ').map(word => word.charAt(0)).join('').slice(0, 3).toUpperCase();
    
    // Find the last product with this prefix to determine the next sequence number.
    // Note: This can have a race condition under very high load. For most systems, this is sufficient.
    const lastProduct = await Product.findOne({ sku: new RegExp(`^${prefix}-`) }).sort({ createdAt: -1 }).select('sku').lean();
    const lastNumber = lastProduct ? parseInt(lastProduct.sku.split('-')[1], 10) || 0 : 0;
    const newSku = `${prefix}-${String(lastNumber + 1).padStart(3, '0')}`;

    return success(res, 'SKU generated successfully', { sku: newSku });
  } catch (err) {
    next(err);
  }
};

exports.generateVariantSKU = async (req, res, next) => {
  try {
    const { productSKU, size } = req.body;
    if (!productSKU || !size) {
      return next(new ErrorResponse('Product SKU and variant size are required', 400));
    }
    
    const sanitizedSize = size.trim().replace(/\s+/g, '-').toUpperCase();
    const variantSKU = `${productSKU}-${sanitizedSize}`;
    
    const existingProduct = await Product.findOne({ 'variants.sku': variantSKU }).lean();
    if (existingProduct) {
      return next(new ErrorResponse(`Variant SKU ${variantSKU} already exists`, 400));
    }
    
    return success(res, 'Variant SKU generated successfully', { sku: variantSKU });
  } catch (error) {
    next(error);
  }
};

// #endregion