// File: src/controllers/admin/products.controller.js
const Product = require('../../models/product.model');
const Category = require('../../models/category.model');
const Settings = require('../../models/settings.model');
const { ErrorResponse } = require('../../middleware/error.middleware');
const cloudinary = require('../../config/cloudinary');
const mongoose = require('mongoose');
const fs = require('fs').promises;
const { success, paginate } = require('../../utils/response.util');
const { calculateProductStatus } = require('../../utils/product.util'); // Import the shared utility

// #region ============================ Product Retrieval ============================

exports.getProducts = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const startIndex = (page - 1) * limit;

        // Fetch lowStockThreshold from Settings
        const settings = await Settings.getSettings();
        const lowStockThreshold = settings.lowStockThreshold || 5;

        const { status, category, featured, stock, search, sort } = req.query;

        // Base filter for direct fields (status, category, featured)
        const baseFilter = {};
        if (status && ['draft', 'published', 'archived'].includes(status)) {
            baseFilter.status = status;
        }
        if (category) {
            // Validate category existence early
            const categoryExists = await Category.exists({ _id: category });
            if (!categoryExists) {
                return next(new ErrorResponse(`Category not found with id of ${category}`, 404));
            }
            
           // Convert the string from the query into a MongoDB ObjectId
    baseFilter.category = new mongoose.Types.ObjectId(category); 
        }
        if (featured) {
            baseFilter.featured = featured === 'true';
        }

        // --- CRITICAL FIX: Stock Filtering using Aggregation Pipeline for consistency ---
        // We need to use aggregation to correctly filter by stock status,
        // especially for products with variants, by calculating a totalEffectiveStock.
        const aggregationPipeline = [];

        // Apply base filter if any
        if (Object.keys(baseFilter).length > 0) {
            aggregationPipeline.push({ $match: baseFilter });
        }

        // Add a field for total effective stock (main product stock or sum of variant stocks)
        aggregationPipeline.push({
            $addFields: {
                totalEffectiveStock: {
                    $cond: {
                        if: { $gt: [{ $size: { $ifNull: ['$variants', []] } }, 0] }, // If product has variants
                        then: { $sum: '$variants.stockQuantity' }, // Sum variant stock quantities
                        else: '$stockQuantity' // Otherwise, use main product stock quantity
                    }
                }
            }
        });

        // Apply stock filter based on the calculated totalEffectiveStock
        if (stock) {
            let stockMatch = {};
            switch (stock) {
                case 'in_stock':
                    stockMatch = { totalEffectiveStock: { $gt: lowStockThreshold } };
                    break;
                case 'out_of_stock':
                    stockMatch = { totalEffectiveStock: { $lte: 0 } };
                    break;
                case 'low_stock':
                    stockMatch = { totalEffectiveStock: { $gt: 0, $lte: lowStockThreshold } };
                    break;
                default:
                    return next(new ErrorResponse(`Invalid stock filter: ${stock}`, 400));
            }
            aggregationPipeline.push({ $match: stockMatch });
        }

        // Apply search filter (name, SKU, variant SKU)
        if (search) {
            const searchRegex = new RegExp(search, 'i');
            aggregationPipeline.push({
                $match: {
                    $or: [
                        { name: searchRegex },
                        { sku: searchRegex },
                        { 'variants.sku': searchRegex },
                    ],
                },
            });
        }

        // Project fields and populate category for the final output
        aggregationPipeline.push(
            {
                $lookup: {
                    from: 'categories', // The collection name for categories
                    localField: 'category',
                    foreignField: '_id',
                    as: 'category',
                },
            },
            { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } }, // Unwind to de-array the category
            {
                $project: {
                    _id: 1,
                    name: 1,
                    sku: 1,
                    price: 1,
                    stockQuantity: 1, // Keep original stockQuantity for individual product display
                    reorderPoint: 1,
                    category: { _id: '$category._id', name: '$category.name' },
                    variants: 1,
                    images: 1,
                    status: 1, // Keep original product status (draft, published, etc.)
                    totalEffectiveStock: 1, // Pass this for calculateProductStatus
                },
            }
        );

        // Add sorting
        const sortField = sort || '-createdAt';
        const sortOrder = sortField.startsWith('-') ? -1 : 1;
        const actualSortField = sortField.replace('-', '');
        aggregationPipeline.push({ $sort: { [actualSortField]: sortOrder } });

        // Add pagination
        aggregationPipeline.push(
            { $skip: startIndex },
            { $limit: limit }
        );

        // Get total count for pagination (using a separate aggregation or countDocuments before main aggregation)
        // For simplicity and to avoid running the full pipeline twice, we'll run a count aggregation first.
        const countPipeline = [];
        if (Object.keys(baseFilter).length > 0) {
            countPipeline.push({ $match: baseFilter });
        }
        countPipeline.push({
            $addFields: {
                totalEffectiveStock: {
                    $cond: {
                        if: { $gt: [{ $size: { $ifNull: ['$variants', []] } }, 0] },
                        then: { $sum: '$variants.stockQuantity' },
                        else: '$stockQuantity'
                    }
                }
            }
        });
        if (stock) {
            let stockMatch = {};
            switch (stock) {
                case 'in_stock':
                    stockMatch = { totalEffectiveStock: { $gt: lowStockThreshold } };
                    break;
                case 'out_of_stock':
                    stockMatch = { totalEffectiveStock: { $lte: 0 } };
                    break;
                case 'low_stock':
                    stockMatch = { totalEffectiveStock: { $gt: 0, $lte: lowStockThreshold } };
                    break;
            }
            countPipeline.push({ $match: stockMatch });
        }
        if (search) {
            const searchRegex = new RegExp(search, 'i');
            countPipeline.push({
                $match: {
                    $or: [
                        { name: searchRegex },
                        { sku: searchRegex },
                        { 'variants.sku': searchRegex },
                    ],
                },
            });
        }
        countPipeline.push({ $count: 'total' });

        const [products, totalResult] = await Promise.all([
            Product.aggregate(aggregationPipeline),
            Product.aggregate(countPipeline)
        ]);

        const total = totalResult[0]?.total || 0;

        const formattedProducts = products.map(product => {
            // Use the shared utility to determine stock status
            const stockStatus = calculateProductStatus(product, lowStockThreshold);

            return {
                id: product._id,
                name: product.name,
                sku: product.sku,
                price: product.price,
                stock: product.stockQuantity, // This is the main product's stock, as per original response
                stockStatus: stockStatus.replace(/_/g, ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '), // Format for display: "Low Stock"
                categoryName: product.category ? product.category.name : 'Uncategorized',
                status: product.status, // Product's draft/published/archived status
                images: product.images || [],
                variants: product.variants || [],
            };
        });

        console.log(formattedProducts)

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
  console.log('hitted get admin product')
    try {
        const product = await Product.findById(req.params.id).populate('category', 'name').lean();

        if (!product) {
            return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
        }

        // --- CRITICAL FIX: Preserve original array structures for scentNotes and ingredients ---
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
            // Preserve top, middle, base as separate arrays
            scentNotes: {
                top: product.scentNotes?.top || [],
                middle: product.scentNotes?.middle || [],
                base: product.scentNotes?.base || [],
            },
            ingredients: product.ingredients || [], // Keep as array, not joined string
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
            // --- NOTE ON RACE CONDITION: This SKU generation logic can lead to race conditions
            // under very high concurrent load, where multiple requests might generate the same SKU.
            // For a small e-commerce site, this might be acceptable, but for high-traffic,
            // a more robust, transactional SKU generation mechanism (e.g., using a dedicated sequence
            // in the database or a distributed lock) would be required.
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
                return next(new ErrorResponse('Duplicate variant SKUs provided in the request', 400));
            }

            // Check if any of these variant SKUs already exist in the database
            const existingVariantProduct = await Product.findOne({ 'variants.sku': { $in: variantSkus } }).lean();
            if (existingVariantProduct) {
                return next(new ErrorResponse(`One or more variant SKUs already exist in product: ${existingVariantProduct.name}`, 400));
            }

            // Use a for...of loop to allow early exit on error and proper validation
            for (const [index, variant] of variants.entries()) {
                if (!variant.size || variant.stockQuantity === undefined || !variant.scentIntensity || !variant.sku) {
                    return next(new ErrorResponse(`Variant at index ${index} is missing required fields: size, stockQuantity, scentIntensity, sku`, 400));
                }
                if (typeof variant.stockQuantity !== 'number' || variant.stockQuantity < 0) {
                    return next(new ErrorResponse(`Variant at index ${index}: stockQuantity must be a non-negative number`, 400));
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
            name,
            sku: finalSku,
            price,
            stockQuantity,
            status: status || 'draft',
            category,
            description,
            scentNotes: scentNotes || {}, // Ensure scentNotes is an object, even if empty
            ingredients: ingredients || [], // Ensure ingredients is an array, even if empty
            variants: formattedVariants,
            images: [], // Initialize empty, images are uploaded via a separate endpoint
            createdBy: req.user._id,
        });

        const newProduct = await product.save();

        // Populate the new document without a second DB call
        await newProduct.populate([
            { path: 'category', select: 'name slug' },
            { path: 'createdBy', select: 'firstName lastName' } // Populate with full name
        ]);

        return success(res, 'Product created successfully', { product: newProduct }, 201);
    } catch (err) {
        if (err.name === 'ValidationError') {
            const messages = Object.values(err.errors).map((val) => val.message);
            return next(new ErrorResponse(messages.join(', '), 400));
        }
        // Handle duplicate key errors specifically for unique fields like SKU
        if (err.code === 11000) {
            const field = Object.keys(err.keyValue)[0];
            const value = err.keyValue[field];
            return next(new ErrorResponse(`Duplicate field value: ${value} for ${field}. Please use another value.`, 400));
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
                return next(new ErrorResponse('Duplicate variant SKUs within the product update request', 400));
            }

            // Check for variant SKUs existing in *other* products
            const existingVariantProduct = await Product.findOne({
                _id: { $ne: product._id }, // Exclude the current product
                'variants.sku': { $in: variantSkus }
            });
            if (existingVariantProduct) {
                return next(new ErrorResponse(`One or more variant SKUs already exist in another product: ${existingVariantProduct.name}`, 400));
            }

            // Validate individual variant fields
            for (const [index, variant] of variants.entries()) {
                if (!variant.size || variant.stockQuantity === undefined || !variant.scentIntensity || !variant.sku) {
                    return next(new ErrorResponse(`Invalid variant at index ${index}: size, stockQuantity, scentIntensity, and sku are required`, 400));
                }
                if (typeof variant.stockQuantity !== 'number' || variant.stockQuantity < 0) {
                    return next(new ErrorResponse(`Variant at index ${index}: stockQuantity must be a non-negative number`, 400));
                }
            }
            req.body.variants = variants; // Assign validated variants back to req.body
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
            context: 'query', // Ensures validators run on update operations
        }).populate([
            { path: 'category', select: 'name slug' },
            { path: 'createdBy', select: 'firstName lastName' },
            { path: 'updatedBy', select: 'firstName lastName' }
        ]);

        return success(res, 'Product updated successfully', { product: updatedProduct });
    } catch (err) {
        if (err.name === 'ValidationError') {
            const messages = Object.values(err.errors).map((val) => val.message);
            return next(new ErrorResponse(messages.join(', '), 400));
        }
        if (err.code === 11000) { // Handle duplicate key errors
            const field = Object.keys(err.keyValue)[0];
            const value = err.keyValue[field];
            return next(new ErrorResponse(`Duplicate field value: ${value} for ${field}. Please use another value.`, 400));
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

        // Delete associated images from Cloudinary concurrently
        if (product.images && product.images.length > 0) {
            const publicIds = product.images.map(image => image.public_id).filter(Boolean); // Filter out any null/undefined public_ids
            if (publicIds.length > 0) {
                await Promise.all(
                    publicIds.map(publicId => cloudinary.uploader.destroy(publicId).catch(err => {
                        console.error(`Failed to delete Cloudinary image ${publicId}:`, err);
                        // Do not re-throw here; allow other deletions to proceed
                    }))
                );
            }
        }

        await product.deleteOne(); // Use deleteOne() on the document instance

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
                    unique_filename: false, // Set to true if you want Cloudinary to generate unique filenames
                    timeout: 60000, // 60 seconds timeout
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
                // Continue processing other files even if one fails, but report the error
                addToast(`Failed to upload image ${file.originalname}: ${cloudinaryErr.message}`, 'error'); // Assuming addToast is available or similar
            } finally {
                // Clean up the local file regardless of upload success or failure
                await fs.unlink(filePath).catch(err => console.error(`Failed to delete temp file ${filePath}:`, err));
            }
        }

        if (uploadedImages.length === 0 && req.files.length > 0) {
            // If files were provided but none were successfully uploaded
            return next(new ErrorResponse('No images were successfully uploaded.', 500));
        }

        product.images.push(...uploadedImages);
        product.updatedBy = req.user.id; // Record who updated the product
        await product.save();

        await product.populate([
            { path: 'category', select: 'name slug' },
            { path: 'createdBy', select: 'firstName lastName' },
            { path: 'updatedBy', select: 'firstName lastName' }
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
            await cloudinary.uploader.destroy(image.public_id).catch(err => {
                console.error(`Failed to delete Cloudinary image ${image.public_id}:`, err);
                // Do not block response for Cloudinary error, but log it.
            });
        }

        const wasMainImage = image.isMain;
        image.remove(); // Use Mongoose sub-document remove method

        // If the deleted image was the main one, and there are other images left,
        // set the first remaining image as the new main image.
        if (wasMainImage && product.images.length > 0) {
            // Find the first image that is not the one just deleted (though image.remove() handles this)
            // and set it as main. Mongoose's .remove() directly modifies the array.
            product.images[0].isMain = true;
        } else if (product.images.length === 0) {
            // If no images are left, ensure no image is marked as main (already implicit)
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

        // --- NOTE ON RACE CONDITION: This SKU generation logic can lead to race conditions
        // under very high concurrent load, where multiple requests might generate the same SKU.
        // For a small e-commerce site, this might be acceptable, but for high-traffic,
        // a more robust, transactional SKU generation mechanism (e.g., using a dedicated sequence
        // in the database or a distributed lock) would be required.
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

        // Check if the generated variant SKU already exists in any product's variants
        const existingProduct = await Product.findOne({ 'variants.sku': variantSKU }).lean();
        if (existingProduct) {
            return next(new ErrorResponse(`Variant SKU ${variantSKU} already exists in product: ${existingProduct.name}`, 400));
        }

        return success(res, 'Variant SKU generated successfully', { sku: variantSKU });
    } catch (error) {
        next(error);
    }
};

// #endregion