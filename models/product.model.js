const mongoose = require('mongoose');
const slugify = require('slugify'); // Use slugify package

const StockAdjustmentSchema = new mongoose.Schema({
  variantId: { type: mongoose.Schema.ObjectId, default: null },
  adjustment: { type: Number, required: true },
  reason: { type: String, required: true },
  previousStock: { type: Number, required: true },
  newStock: { type: Number, required: true },
  adjustedBy: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
  adjustedAt: { type: Date, default: Date.now },
});

const VariantSchema = new mongoose.Schema({
  size: {
    type: String,
    required: [true, 'Please specify the size'],
  },
  scentIntensity: {
    type: String,
    enum: ['light', 'medium', 'strong'],
    default: 'medium',
  },
  stockQuantity: {
    type: Number,
    required: [true, 'Please specify the stock quantity'],
    min: [0, 'Stock quantity cannot be negative'],
  },
  sku: {
    type: String,
    required: [true, 'Please specify the SKU for this variant'],
    unique: true,
    trim: true,
  },
  priceAdjustment: {
    type: Number,
    default: 0,
  },
  isDefault: {
    type: Boolean,
    default: false,
  },
});

const ProductSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a product name'],
    trim: true,
    maxlength: [100, 'Product name cannot be more than 100 characters'],
  },
  slug: {
    type: String,
    unique: true,
  },
  description: {
    type: String,
    required: [true, 'Please add a description'],
    maxlength: [2000, 'Description cannot be more than 2000 characters'],
  },
  price: {
    type: Number,
    required: [true, 'Please add a price'],
    min: [0, 'Price must be greater than 0'],
  },
  sku: {
    type: String,
    required: [true, 'Please add a SKU'],
    unique: true,
    trim: true,
  },
  stockQuantity: {
    type: Number,
    required: [true, 'Please add a stock quantity'],
    min: [0, 'Stock quantity cannot be negative'],
  },
  reorderPoint: {
    type: Number,
    default: 10,
    min: [0, 'Reorder point cannot be negative'],
  },
  category: {
    type: mongoose.Schema.ObjectId,
    ref: 'Category',
    required: [true, 'Please specify a category'],
  },
  scentNotes: {
    top: [String],
    middle: [String],
    base: [String],
  },
  ingredients: [String],
  variants: [VariantSchema],
  stockAdjustments: [StockAdjustmentSchema],
  images: [
    {
      url: { type: String, required: true },
      isMain: { type: Boolean, default: false },
      alt: String,
    },
  ],
  status: {
    type: String,
    enum: ['draft', 'published', 'archived'],
    default: 'draft',
  },
  featured: {
    type: Boolean,
    default: false,
  },
  averageRating: {
    type: Number,
    min: [1, 'Rating must be at least 1'],
    max: [5, 'Rating cannot be more than 5'],
  },
  numReviews: {
    type: Number,
    default: 0,
  },
  createdBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true,
  },
  updatedBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
  },
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

ProductSchema.pre('save', function (next) {
  if (this.isModified('name')) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }
  this.updatedAt = Date.now();
  next();
});

ProductSchema.index({ createdAt: -1 });
ProductSchema.index({ updatedAt: -1, stockQuantity: 1 });

ProductSchema.virtual('reviews', {
  ref: 'Review',
  localField: '_id',
  foreignField: 'product',
  justOne: false,
});

ProductSchema.statics.getTotalInventoryValue = async function () {
  const result = await this.aggregate([
    {
      $project: {
        totalValue: {
          $sum: [
            { $multiply: ['$price', '$stockQuantity'] },
            {
              $sum: {
                $map: {
                  input: '$variants',
                  as: 'variant',
                  in: { $multiply: [{ $add: ['$price', '$$variant.priceAdjustment'] }, '$$variant.stockQuantity'] },
                },
              },
            },
          ],
        },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$totalValue' },
      },
    },
  ]);

  return result.length > 0 ? result[0].total : 0;
};

ProductSchema.methods.isLowStock = async function () {
  const Settings = mongoose.model('Settings');
  const settings = await Settings.getSettings();
  const threshold = settings.lowStockThreshold || 10;
  const variantLowStock = this.variants.some(variant => variant.stockQuantity <= threshold);
  return this.stockQuantity <= threshold || variantLowStock;
};

module.exports = mongoose.model('Product', ProductSchema);