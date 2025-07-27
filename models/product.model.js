const mongoose = require('mongoose');
const slugify = require('slugify');

const StockAdjustmentSchema = new mongoose.Schema({
    variantId: { type: mongoose.Schema.Types.ObjectId, default: null }, // null for main product
    adjustment: { type: Number, required: true },
    reason: { type: String, required: true },
    previousStock: { type: Number, required: true },
    newStock: { type: Number, required: true },
    adjustedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: { createdAt: 'adjustedAt' } });

const VariantSchema = new mongoose.Schema({
    size: { type: String, required: [true, 'Please specify the size'], trim: true },
    scentIntensity: { type: String, enum: ['light', 'medium', 'strong'], default: 'medium' },
    stockQuantity: { type: Number, required: [true, 'Please specify the stock quantity'], min: 0 },
    sku: { type: String, required: [true, 'Please specify the SKU for this variant'], unique: true, trim: true, sparse: true },
    priceAdjustment: { type: Number, default: 0 },
    isDefault: { type: Boolean, default: false },
});

const ProductSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'Please add a product name'],
            trim: true,
            maxlength: [100, 'Product name cannot be more than 100 characters'],
        },
        slug: { type: String, unique: true, index: true },
        description: { type: String, required: [true, 'Please add a description'], maxlength: [2000, 'Description cannot be more than 2000 characters'] },
        price: { type: Number, required: [true, 'Please add a price'], min: 0 },
        sku: { type: String, required: [true, 'Please add a SKU'], unique: true, trim: true },
        stockQuantity: { type: Number, required: [true, 'Please add a stock quantity'], min: 0 },
        reorderPoint: { type: Number, default: 10, min: 0 },
        category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: [true, 'Please specify a category'], index: true },
        scentNotes: {
            top: [{ type: String, trim: true }],
            middle: [{ type: String, trim: true }],
            base: [{ type: String, trim: true }],
        },
        ingredients: [{ type: String, trim: true }],
        variants: [VariantSchema],
        stockAdjustments: [StockAdjustmentSchema],
        images: [{
            url: { type: String, required: true },
            public_id: { type: String, required: true },
            isMain: { type: Boolean, default: false },
            alt: { type: String, trim: true },
        }],
        status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
        featured: { type: Boolean, default: false },
        averageRating: { type: Number, min: 1, max: 5 },
        numReviews: { type: Number, default: 0, min: 0 },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

ProductSchema.pre('save', function (next) {
    if (this.isModified('name')) {
        this.slug = slugify(this.name, { lower: true, strict: true });
    }
    next();
});

/**
 * @desc Adjusts the stock quantity for the main product or a specific variant and logs the adjustment.
 * @param {object} options - Options for stock adjustment.
 * @param {number} options.adjustment - The quantity to add or subtract.
 * @param {string} options.reason - The reason for the stock adjustment.
 * @param {string} options.userId - The ID of the user performing the adjustment.
 * @param {string} [options.variantId=null] - The ID of the variant to adjust, or null for the main product.
 */
ProductSchema.methods.adjustStock = function({ adjustment, reason, userId, variantId = null }) {
    let stockItem;
    if (variantId) {
        stockItem = this.variants.id(variantId);
        if (!stockItem) throw new Error('Variant not found for stock adjustment.');
    } else {
        stockItem = this; // Main product
    }

    const previousStock = stockItem.stockQuantity;
    const newStock = previousStock + adjustment;
    // The check for negative stock is now done in the controller to provide a better user response

    stockItem.stockQuantity = newStock;
    this.stockAdjustments.push({
        variantId,
        adjustment,
        reason,
        previousStock,
        newStock,
        adjustedBy: userId,
    });
};

// Virtual for reviews
ProductSchema.virtual('reviews', {
    ref: 'Review',
    localField: '_id',
    foreignField: 'product',
    justOne: false,
});

// Indexes for improved query performance
ProductSchema.index({ createdAt: -1 });
ProductSchema.index({ updatedAt: -1, stockQuantity: 1 });
ProductSchema.index({ name: 'text', sku: 'text' }); // Text index for search functionality


/**
 * @desc Calculates the total monetary value of all product inventory.
 * It correctly handles products with and without variants to avoid double-counting.
 * @returns {Promise<number>} The total inventory value.
 */
ProductSchema.statics.getTotalInventoryValue = async function () {
    const result = await this.aggregate([
        {
            $project: {
                _id: 0,
                productValue: {
                    $cond: {
                        // If the product has variants, sum the value of all variants
                        if: { $gt: [{ $size: '$variants' }, 0] },
                        then: {
                            $sum: {
                                $map: {
                                    input: '$variants',
                                    as: 'variant',
                                    in: {
                                        $multiply: [
                                            { $add: ['$price', '$$variant.priceAdjustment'] },
                                            '$$variant.stockQuantity'
                                        ]
                                    },
                                },
                            },
                        },
                        // Otherwise, use the base product's price and stock
                        else: { $multiply: ['$price', '$stockQuantity'] },
                    },
                },
            },
        },
        {
            $group: {
                _id: null,
                total: { $sum: '$productValue' },
            },
        },
    ]);

    return result.length > 0 ? result[0].total : 0;
};

/**
 * @desc Calculates the summary statistics for the inventory (total, low stock, out of stock products).
 * This method is now centralized and used by multiple controller endpoints.
 * @param {number} lowStockThreshold - The threshold for low stock.
 * @returns {Promise<object>} An object containing totalProducts, totalStock, lowStockProducts, outOfStockProducts.
 */
ProductSchema.statics.getInventorySummary = async function (lowStockThreshold) {
    const summaryData = await this.aggregate([
        {
            // Calculate total effective stock for each product (main + variants)
            $addFields: {
                totalEffectiveStock: {
                    $cond: {
                        if: { $gt: [{ $size: { $ifNull: ['$variants', []] } }, 0] },
                        then: { $sum: '$variants.stockQuantity' },
                        else: '$stockQuantity'
                    }
                }
            }
        },
        {
            // Group all products to calculate summary statistics
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
    ]);
    // Return the first element of the result array or a default empty object
    return summaryData[0] || { totalProducts: 0, totalStock: 0, lowStockProducts: 0, outOfStockProducts: 0 };
};


/**
 * @desc Checks if a product or any of its variants are in low stock based on the settings.
 * @returns {Promise<boolean>} True if low stock, false otherwise.
 */
ProductSchema.methods.isLowStock = async function () {
    const Settings = mongoose.model('Settings');
    const settings = await Settings.getSettings();
    const threshold = settings.lowStockThreshold || 10;

    // Calculate effective stock using the same logic as in getInventorySummary
    const hasVariants = this.variants && this.variants.length > 0;
    let effectiveStock = 0;
    if (hasVariants) {
        effectiveStock = this.variants.reduce((sum, v) => sum + (v.stockQuantity || 0), 0);
    } else {
        effectiveStock = this.stockQuantity || 0;
    }

    return effectiveStock > 0 && effectiveStock <= threshold;
};

module.exports = mongoose.model('Product', ProductSchema);
