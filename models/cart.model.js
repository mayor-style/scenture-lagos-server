const mongoose = require('mongoose');

const CartItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  productName: {
    type: String,
    required: true,
  },
  productSlug: {
    type: String,
    required: true,
  },
  productImage: {
    type: String,
    required: false,
  },
  category: {
    type: String,
    required: false, // Added to store product category
  },
  variant: {
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
    },
    size: String,
    scentIntensity: String,
    sku: String,
    priceAdjustment: Number,
  },
  sku: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  total: {
    type: Number,
    required: true,
  },
});

const CartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false, // Null for guest users
    },
    items: [CartItemSchema],
    totalItems: {
      type: Number,
      default: 0,
    },
    subtotal: {
      type: Number,
      default: 0,
    },
    discount: {
      type: Number,
      default: 0,
    },
    total: {
      type: Number,
      default: 0,
    },
    coupon: {
      code: String,
      discount: Number,
    },
  },
  { timestamps: true }
);

// Pre-save hook to calculate totals
CartSchema.pre('save', function (next) {
  this.totalItems = this.items.reduce((sum, item) => sum + item.quantity, 0);
  this.subtotal = this.items.reduce((sum, item) => sum + item.total, 0);
  this.total = this.subtotal - (this.discount || 0);
  next();
});

module.exports = mongoose.model('Cart', CartSchema);