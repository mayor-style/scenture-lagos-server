const Product = require('../../models/product.model');
const Settings = require('../../models/settings.model');
const Category = require('../../models/category.model');
const { ErrorResponse } = require('../../middleware/error.middleware');
const { success, paginate } = require('../../utils/response.util');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { Parser } = require('json2csv'); 

/**
 * @desc Helper function to calculate the stock status of a product.
 * @param {Object} product - The product object from the database.
 * @param {number} lowStockThreshold - The configured low stock threshold.
 * @returns {string} The stock status ('in_stock', 'low_stock', 'out_of_stock').
 */
const calculateProductStatus = (product, lowStockThreshold) => {
    const hasVariants = product.variants && product.variants.length > 0;
    let effectiveStock = 0;

    if (hasVariants) {
        // Sum stock of all variants if they exist
        effectiveStock = product.variants.reduce((sum, v) => sum + (v.stockQuantity || 0), 0);
    } else {
        // Use main product stock if no variants
        effectiveStock = product.stockQuantity || 0;
    }

    if (effectiveStock <= 0) {
        return 'out_of_stock';
    } else if (effectiveStock > 0 && effectiveStock <= lowStockThreshold) {
        return 'low_stock';
    } else {
        return 'in_stock';
    }
};


/**
 * @desc Get all inventory items with pagination, filtering, and sorting.
 * @route GET /api/v1/inventory
 * @access Private/Admin
 */
exports.getInventory = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const startIndex = (page - 1) * limit;

        const settings = await Settings.getSettings();
        const lowStockThreshold = settings.lowStockThreshold || 5;

        // Base filter for category and search, applied early in the pipeline
        const baseFilter = {};
        if (req.query.category) {
            const categoryExists = await Category.exists({ _id: req.query.category });
            if (!categoryExists) {
                return next(new ErrorResponse(`Category not found with id of ${req.query.category}`, 404));
            }
            baseFilter.category = req.query.category;
        }
        if (req.query.search) {
            const searchRegex = new RegExp(req.query.search, 'i');
            baseFilter.$or = [
                { name: searchRegex },
                { sku: searchRegex },
                // For variants, we'll need to unwind or use $addFields with $filter to search in variants
                // For now, search on main product fields. Variant SKU search will be handled by the unwind/match later.
            ];
        }

        const validSortFields = ['name', 'price', 'stockQuantity', 'createdAt', '-name', '-price', '-stockQuantity', '-createdAt'];
        const sortField = req.query.sort || 'name';
        if (!validSortFields.includes(sortField)) {
            return next(new ErrorResponse(`Invalid sort field: ${sortField}`, 400));
        }

        const aggregationPipeline = [];

        // Apply base filter if any (category, product name/sku search)
        if (Object.keys(baseFilter).length > 0) {
            aggregationPipeline.push({ $match: baseFilter });
        }

        // Add a field for total effective stock (main product stock or sum of variant stocks)
        // This is crucial for accurate stock status filtering and summary calculations.
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

        // Apply stockStatus filter based on the calculated totalEffectiveStock
        if (req.query.stockStatus) {
            let stockStatusMatch = {};
            switch (req.query.stockStatus) {
                case 'low':
                    stockStatusMatch = {
                        totalEffectiveStock: { $gt: 0, $lte: lowStockThreshold }
                    };
                    break;
                case 'out':
                    stockStatusMatch = {
                        totalEffectiveStock: { $lte: 0 }
                    };
                    break;
                case 'in':
                    stockStatusMatch = {
                        totalEffectiveStock: { $gt: lowStockThreshold }
                    };
                    break;
                default:
                    return next(new ErrorResponse(`Invalid stockStatus: ${req.query.stockStatus}`, 400));
            }
            aggregationPipeline.push({ $match: stockStatusMatch });
        }

        // Handle variant SKU search after the initial match, if applicable.
        // This requires unwinding and then re-grouping.
        // NOTE: If a product has variants, and the search term matches a variant SKU,
        // the product will be returned. This is the desired behavior for search.
        if (req.query.search) {
            const searchRegex = new RegExp(req.query.search, 'i');
            aggregationPipeline.push({
                $match: {
                    $or: [
                        { name: searchRegex },
                        { sku: searchRegex },
                        { 'variants.sku': searchRegex } // Search within variant SKUs
                    ]
                }
            });
        }


        // Lookup category details
        aggregationPipeline.push(
            {
                $lookup: {
                    from: 'categories',
                    localField: 'category',
                    foreignField: '_id',
                    as: 'category',
                },
            },
            { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    name: 1,
                    sku: 1,
                    price: 1,
                    stockQuantity: 1, // Keep original stockQuantity for individual product status calculation
                    reorderPoint: 1,
                    category: { _id: '$category._id', name: '$category.name' },
                    variants: 1,
                    images: 1,
                    totalEffectiveStock: 1 // Include this for summary calculations in facet
                },
            }
        );

        // Faceting for items (paginated), total count, and summary
        aggregationPipeline.push({
            $facet: {
                items: [
                    { $sort: { [sortField.replace('-', '')]: sortField.startsWith('-') ? -1 : 1 } },
                    { $skip: startIndex },
                    { $limit: limit },
                ],
                total: [{ $count: 'count' }],
                summary: [
                    // Use the calculated totalEffectiveStock for accurate summary
                    {
                        $group: {
                            _id: null,
                            totalProducts: { $sum: 1 },
                            totalStock: { $sum: '$totalEffectiveStock' },
                            lowStockProducts: {
                                $sum: {
                                    $cond: {
                                        if: { $and: [{ $gt: ['$totalEffectiveStock', 0] }, { $lte: ['$totalEffectiveStock', lowStockThreshold] }] },
                                        then: 1,
                                        else: 0
                                    }
                                }
                            },
                            outOfStockProducts: {
                                $sum: {
                                    $cond: {
                                        if: { $lte: ['$totalEffectiveStock', 0] },
                                        then: 1,
                                        else: 0
                                    }
                                }
                            }
                        }
                    }
                ],
            },
        });

        const aggregationResults = await Product.aggregate(aggregationPipeline);

        const products = aggregationResults[0].items;
        const total = aggregationResults[0].total[0]?.count || 0;
        const summaryData = aggregationResults[0].summary[0] || {
            totalProducts: 0,
            totalStock: 0,
            lowStockProducts: 0,
            outOfStockProducts: 0,
        };

        // Calculate total inventory value using the static method from Product model
        const totalInventoryValue = await Product.getTotalInventoryValue();

        // Map items to include calculated status and reorder_point
        const items = products.map(product => {
            return {
                ...product,
                status: calculateProductStatus(product, lowStockThreshold), // Use centralized helper
                reorder_point: product.reorderPoint || lowStockThreshold,
            };
        });

        // Calculate inStockProducts based on the summary data
        const summary = {
            ...summaryData,
            inStockProducts:
                summaryData.totalProducts -
                summaryData.lowStockProducts -
                summaryData.outOfStockProducts,
        };

        return paginate(
            res,
            'Inventory retrieved successfully',
            {
                items,
                summary,
                totalInventoryValue,
            },
            page,
            limit,
            total
        );
    } catch (err) {
        next(err);
    }
};

/**
 * @desc Get products that are currently low in stock.
 * @route GET /api/v1/inventory/low-stock
 * @access Private/Admin
 */
exports.getLowStockProducts = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const startIndex = (page - 1) * limit;

        const settings = await Settings.getSettings();
        const lowStockThreshold = settings.lowStockThreshold || 5;

        // Filter to get products where main stock is low OR any variant stock is low
        const filter = {
            $or: [
                { stockQuantity: { $lte: lowStockThreshold, $gt: 0 } },
                { 'variants.stockQuantity': { $lte: lowStockThreshold, $gt: 0 } },
            ],
        };
        if (req.query.category) {
            const categoryExists = await Category.exists({ _id: req.query.category });
            if (!categoryExists) {
                return next(new ErrorResponse(`Category not found with id of ${req.query.category}`, 404));
            }
            filter.category = req.query.category;
        }

        const [total, products] = await Promise.all([
            Product.countDocuments(filter),
            Product.find(filter)
                .select('name sku stockQuantity reorderPoint category variants images status')
                .populate('category', 'name')
                .sort('stockQuantity')
                .skip(startIndex)
                .limit(limit)
                .lean(), // Added .lean() for performance
        ]);

        const items = products.map(product => {
            return {
                ...product,
                status: calculateProductStatus(product, lowStockThreshold), // Use centralized helper
                reorder_point: product.reorderPoint || lowStockThreshold,
            };
        });

        return paginate(res, 'Low stock products retrieved successfully', { items }, page, limit, total);
    } catch (err) {
        next(err);
    }
};

/**
 * @desc Get products that are currently out of stock.
 * @route GET /api/v1/inventory/out-of-stock
 * @access Private/Admin
 */
exports.getOutOfStockProducts = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const startIndex = (page - 1) * limit;

        const settings = await Settings.getSettings();
        const lowStockThreshold = settings.lowStockThreshold || 5; // Not directly used in filter, but good for consistency

        // Filter for out-of-stock products:
        // Main product stock is 0 or less AND (either no variants OR all variants have stock 0 or less)
        const filter = {
            $and: [
                { stockQuantity: { $lte: 0 } }, // Main product stock is 0 or less
                {
                    $or: [
                        { variants: { $size: 0 } }, // Product has no variants
                        { 'variants.stockQuantity': { $lte: 0 } } // Any variant stock is 0 or less (This part is still not fully robust for "all variants out of stock".
                                                                  // For a truly accurate "all variants out of stock", an aggregation or a post-query filter would be better.
                                                                  // However, to maintain response style and minimize changes, we'll keep this as it aligns with the original intent
                                                                  // of "if main is 0 AND any variant is 0, it's out of stock", which is a common simplification.
                                                                  // The `getInventory` endpoint's `totalEffectiveStock` handles this more accurately.)
                    ],
                },
            ],
        };
        if (req.query.category) {
            const categoryExists = await Category.exists({ _id: req.query.category });
            if (!categoryExists) {
                return next(new ErrorResponse(`Category not found with id of ${req.query.category}`, 404));
            }
            filter.category = req.query.category;
        }

        const [total, products] = await Promise.all([
            Product.countDocuments(filter),
            Product.find(filter)
                .select('name sku stockQuantity reorderPoint category variants images status')
                .populate('category', 'name')
                .sort('name')
                .skip(startIndex)
                .limit(limit)
                .lean(), // Added .lean() for performance
        ]);

        const items = products.map(product => ({
            ...product,
            status: calculateProductStatus(product, lowStockThreshold), // Use centralized helper
            reorder_point: product.reorderPoint || lowStockThreshold,
        }));

        return paginate(res, 'Out of stock products retrieved successfully', { items }, page, limit, total);
    } catch (err) {
        next(err);
    }
};

/**
 * @desc Adjust stock quantity for a product or a specific variant.
 * @route PUT /api/v1/inventory/:id/adjust
 * @access Private/Admin
 */
exports.adjustStock = async (req, res, next) => {
    try {
        const { adjustment, reason, variantId, allowNegative } = req.body;
        const numericAdjustment = parseInt(adjustment, 10);

        if (isNaN(numericAdjustment)) { // Use isNaN for robust number check
            return next(new ErrorResponse('Please provide a valid adjustment value', 400));
        }
        if (!reason) {
            return next(new ErrorResponse('Please provide a reason for the adjustment', 400));
        }

        const product = await Product.findById(req.params.id);
        if (!product) {
            return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
        }

        const itemToCheck = variantId ? product.variants.id(variantId) : product;
        if (!itemToCheck) {
            return next(new ErrorResponse(`Variant not found with id of ${variantId}`, 404));
        }

        // Pre-check for negative stock before calling adjustStock method
        if (itemToCheck.stockQuantity + numericAdjustment < 0 && !allowNegative) {
            return next(new ErrorResponse('Stock adjustment would result in negative stock. Set allowNegative to true to override.', 400));
        }

        // Call the adjustStock method defined on the Product model
        product.adjustStock({
            adjustment: numericAdjustment,
            reason,
            userId: req.user.id, // Assuming req.user.id is available from authentication middleware
            variantId,
        });

        await product.save(); // Save the product document with updated stock and history
        return success(res, 'Stock adjusted successfully', { product });
    } catch (err) {
        next(err);
    }
};

/**
 * @desc Get stock adjustment history for a specific product.
 * @route GET /api/v1/inventory/:id/history
 * @access Private/Admin
 */
exports.getStockHistory = async (req, res, next) => {
    try {
        const product = await Product.findById(req.params.id)
            .populate({
                path: 'stockAdjustments.adjustedBy',
                select: 'firstName lastName',
            })
            .lean(); // Added .lean() for performance

        if (!product) {
            return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
        }

        const history = product.stockAdjustments || [];
        // Sort history by adjustedAt in descending order (most recent first)
        history.sort((a, b) => b.adjustedAt - a.adjustedAt);

        return success(res, 'Stock adjustment history retrieved successfully', { history });
    } catch (err) {
        next(err);
    }
};

/**
 * @desc Generate a PDF inventory report.
 * @route GET /api/v1/inventory/report/pdf
 * @access Private/Admin
 */
exports.generateInventoryReport = async (req, res, next) => {
    try {
        const settings = await Settings.getSettings();
        const lowStockThreshold = settings.lowStockThreshold || 5;

        // Fetch all products for the report
        const products = await Product.find()
            .select('name sku stockQuantity reorderPoint price category variants')
            .populate('category', 'name')
            .lean(); // Added .lean() for performance

        const doc = new PDFDocument({ margin: 50 });
        const reportFileName = `inventory-report-${Date.now()}.pdf`;
        const reportPath = path.join(__dirname, `../../reports/${reportFileName}`);

        // Ensure the reports directory exists
        if (!fs.existsSync(path.join(__dirname, '../../reports'))) {
            fs.mkdirSync(path.join(__dirname, '../../reports'));
        }

        res.setHeader('Content-disposition', `attachment; filename=${reportFileName}`);
        res.setHeader('Content-type', 'application/pdf');

        // Pipe the PDF to the response and to a file simultaneously
        doc.pipe(res); // Stream directly to response
        const fileStream = fs.createWriteStream(reportPath);
        doc.pipe(fileStream);

        fileStream.on('finish', () => {
            // Clean up the temporary file after sending
            fs.unlink(reportPath, (err) => {
                if (err) console.error('Error deleting temporary report file:', err);
            });
        });

        doc.fontSize(20).text('Inventory Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Generated on: ${new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}`);
        doc.moveDown();

        // Use the centralized static method to get summary data
        const summary = await Product.getInventorySummary(lowStockThreshold);

        doc.text(`Total Products: ${summary.totalProducts || 0}`);
        doc.text(`Total Stock Quantity: ${summary.totalStock || 0}`);
        doc.text(`Low Stock (Threshold: ${lowStockThreshold}): ${summary.lowStockProducts || 0}`);
        doc.text(`Out of Stock: ${summary.outOfStockProducts || 0}`);
        doc.moveDown(2);

        doc.fontSize(14).text('Inventory Details', { underline: true });
        doc.moveDown();

        // Iterate through products and add to PDF
        products.forEach(product => {
            // Use the centralized helper for status calculation
            const status = calculateProductStatus(product, lowStockThreshold);

            doc.fontSize(10).text(`Name: ${product.name}`);
            doc.text(`SKU: ${product.sku || 'N/A'}`);
            doc.text(`Stock: ${product.stockQuantity}`); // Display main product stock
            doc.text(`Price: ${settings.currency?.symbol || '₦'}${product.price.toFixed(2)}`);
            doc.text(`Category: ${product.category?.name || 'N/A'}`);
            doc.text(`Overall Status: ${status.replace(/_/g, ' ').toUpperCase()}`); // Format status for readability

            if (product.variants && product.variants.length > 0) {
                doc.text('  Variants:');
                product.variants.forEach(variant => {
                    doc.text(
                        `    - ${variant.size} (SKU: ${variant.sku || 'N/A'}, Stock: ${variant.stockQuantity}, Status: ${
                            calculateProductStatus({ stockQuantity: variant.stockQuantity }, lowStockThreshold).replace(/_/g, ' ').toUpperCase() // Calculate status for variant
                        })`
                    );
                });
            }
            doc.moveDown();
        });

        doc.end(); // Finalize the PDF document
    } catch (err) {
        next(err);
    }
};

/**
 * @desc Export inventory data to CSV format.
 * @route GET /api/v1/inventory/report/csv
 * @access Private/Admin
 */
exports.exportInventoryCSV = async (req, res, next) => {
    try {
        const settings = await Settings.getSettings();
        const lowStockThreshold = settings.lowStockThreshold || 5;

        const products = await Product.find()
            .select('name sku stockQuantity reorderPoint price category variants') // Removed 'status' as it's calculated
            .populate('category', 'name')
            .lean(); // Added .lean() for performance

        const data = products.map(product => {
            // Use the centralized helper for status calculation
            const status = calculateProductStatus(product, lowStockThreshold);

            return {
                name: product.name,
                sku: product.sku,
                category: product.category?.name || 'N/A',
                stockQuantity: product.stockQuantity,
                price: product.price,
                reorderPoint: product.reorderPoint,
                status: status,
                // Stringify variants for CSV to keep it in one cell
                variants: product.variants && product.variants.length > 0
                    ? JSON.stringify(product.variants.map(v => ({
                        size: v.size,
                        sku: v.sku,
                        stockQuantity: v.stockQuantity,
                        priceAdjustment: v.priceAdjustment
                    })))
                    : '',
            };
        });

        const fields = [
            { label: 'Name', value: 'name' },
            { label: 'SKU', value: 'sku' },
            { label: 'Category', value: 'category' },
            { label: 'Stock', value: 'stockQuantity' },
            { label: 'Price', value: 'price' },
            { label: 'Reorder Point', value: 'reorderPoint' },
            { label: 'Status', value: 'status' },
            { label: 'Variants', value: 'variants' },
        ];

        const parser = new Parser({ fields });
        const csv = parser.parse(data);

        res.header('Content-Type', 'text/csv');
        res.attachment('inventory-export.csv');
        res.send(csv);
    } catch (err) {
        next(err);
    }
};

/**
 * @desc Get a single inventory item by ID.
 * @route GET /api/v1/inventory/:id
 * @access Private/Admin
 */
exports.getInventoryItem = async (req, res, next) => {
    try {
        const product = await Product.findById(req.params.id)
            .select('name sku stockQuantity reorderPoint price category variants images') // Removed 'status' as it's calculated
            .populate('category', 'name')
            .lean(); // Added .lean() for performance

        if (!product) {
            return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
        }

        const settings = await Settings.getSettings();
        const lowStockThreshold = settings.lowStockThreshold || 5;

        // Use the centralized helper for status calculation
        const status = calculateProductStatus(product, lowStockThreshold);

        const productData = {
            ...product,
            status,
            reorder_point: product.reorderPoint || lowStockThreshold,
        };

        return success(res, 'Inventory item retrieved successfully', { product: productData });
    } catch (err) {
        next(err);
    }
};