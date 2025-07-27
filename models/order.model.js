// In order.model.js

const mongoose = require('mongoose');

const OrderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.ObjectId,
    ref: 'Product',
    required: true
  },
  variant: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  name: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: [1, 'Quantity must be at least 1']
  },
  price: {
    type: Number,
    required: true,
    min: [0, 'Price must be greater than 0']
  },
  // Subtotal will be calculated in the application logic before saving, or as a virtual.
  // Keeping it as a stored field is fine for historical accuracy and ease of querying.
  subtotal: {
    type: Number,
    required: true, // Should be required if always calculated and stored
    min: [0, 'Subtotal must be greater than 0']
  },
  image: String
});

const TimelineEventSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'],
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  note: String,
  updatedBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  }
});

const OrderNoteSchema = new mongoose.Schema({
  content: {
    type: String,
    required: true
  },
  isInternal: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const OrderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true,
    required: true,
    trim: true // Added trim to remove leading/trailing whitespace
  },
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: false // Supports guest orders
  },
  items: [OrderItemSchema],
  subtotal: {
    type: Number,
    required: true,
    min: [0, 'Subtotal must be greater than 0']
  },
  shippingFee: {
    type: Number,
    default: 0,
    min: [0, 'Shipping fee cannot be negative'] // Added validation
  },
  shippingMethod: {
    name: { type: String, required: true },
    rateId: { type: mongoose.Schema.ObjectId },
    price: { type: Number, required: true, min: [0, 'Shipping method price cannot be negative'] }, // Added price validation
    description: { type: String }
  },
  taxAmount: {
    type: Number,
    default: 0,
    min: [0, 'Tax amount cannot be negative'] // Added validation
  },
  taxRate: {
      type: Number,
      default: 0,
      min: [0, 'Tax rate cannot be negative'] // Added validation
  },
  discount: {
    type: Number,
    default: 0,
    min: [0, 'Discount cannot be negative'] // Added validation
  },
  totalAmount: {
    type: Number,
    required: true,
    min: [0, 'Total amount must be greater than 0']
  },
  shippingAddress: {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please add a valid email'] }, // Added email and validation
    street: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    postalCode: { type: String, trim: true },
    country: { type: String, default: 'Nigeria', trim: true },
    phone: { type: String, required: true, trim: true }
  },
  paymentInfo: {
    method: {
      type: String,
      enum: ['paystack', 'bank_transfer', 'cash_on_delivery'],
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending'
    },
    reference: String,
    transactionId: String,
    refundReference: String,
    paidAt: Date,
    details: mongoose.Schema.Types.Mixed
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'],
    default: 'pending'
  },
  timeline: [TimelineEventSchema],
  notes: [OrderNoteSchema],
  createdAt: {
    type: Date,
    default: Date.now
  },
  shippedAt: Date,
  deliveredAt: Date,
  // Added updatedBy for general order updates
  updatedBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } // Add Mongoose timestamps for `updatedAt` field
});

// Indexes for performance
OrderSchema.index({ createdAt: -1, status: 1 });
OrderSchema.index({ 'items.product': 1 });
OrderSchema.index({ 'paymentInfo.status': 1 }); // Added index for payment status

// Pre-save hook for order number generation and timeline updates
OrderSchema.pre('save', async function(next) {
  if (this.isNew && !this.orderNumber) { // Only generate on new documents if not already set
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 5;

    while (!isUnique && attempts < maxAttempts) {
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateStr = `${year}${month}${day}`;
      const randomNum = Math.floor(1000 + Math.random() * 9000);
      const candidateOrderNumber = `SCL-${dateStr}-${randomNum}`;

      const existingOrder = await this.constructor.findOne({ orderNumber: candidateOrderNumber });
      if (!existingOrder) {
        this.orderNumber = candidateOrderNumber;
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      return next(new Error('Failed to generate unique order number after multiple attempts.'));
    }
  }

  // Handle timeline updates and date fields only if status is modified
  if (this.isModified('status')) {
    // Ensure the timeline entry always includes who updated it, falling back to the user if updatedBy is not explicitly set
    this.timeline.push({
      status: this.status,
      timestamp: Date.now(),
      updatedBy: this.updatedBy || this.user // Use this.updatedBy if set, else fallback to this.user
    });

    if (this.status === 'shipped' && !this.shippedAt) {
      this.shippedAt = Date.now();
    } else if (this.status === 'delivered' && !this.deliveredAt) {
      this.deliveredAt = Date.now();
    }
  }

  // Calculate subtotal for order items if not already set or if price/quantity changes
  this.items = this.items.map(item => {
    if (item.isModified('price') || item.isModified('quantity') || item.subtotal === undefined) {
      item.subtotal = item.price * item.quantity;
    }
    return item;
  });

  next();
});

// Virtual for overall order subtotal if not storing directly (though you are)
// If you want to ensure it's always sum of item subtotals for frontend display,
// you could add a virtual or recalculate in controller.
// OrderSchema.virtual('calculatedSubtotal').get(function() {
//   return this.items.reduce((acc, item) => acc + item.subtotal, 0);
// });

OrderSchema.methods.addNote = function(content, userId, isInternal = true) {
  this.notes.push({
    content,
    isInternal,
    createdBy: userId
  });
  return this.save();
};

OrderSchema.statics.getTotalSales = async function(startDate, endDate) {
  const matchStage = {
    'paymentInfo.status': 'paid'
  };
  
  if (startDate && endDate) {
    matchStage.createdAt = {
      $gte: startDate,
      // Ensure endDate includes the entire day
      $lte: new Date(endDate.setHours(23, 59, 59, 999))
    };
  }
  
  const result = await this.aggregate([
    { $match: matchStage },
    { $group: {
        _id: null,
        totalSales: { $sum: '$totalAmount' }
      }
    }
  ]);
  
  return result.length > 0 ? result[0].totalSales : 0;
};

module.exports = mongoose.model('Order', OrderSchema);