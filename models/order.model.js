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
  subtotal: {
    type: Number,
    default: function() {
      return this.price * this.quantity;
    }
  },
  image: String
});

const TimelineEventSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'], // Fixed typo here
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
    required: true
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
    default: 0
  },
  shippingMethod: {
    name: { type: String, required: true },
    rateId: { type: mongoose.Schema.ObjectId }, // Changed from zoneId
    price: { type: Number, required: true }, // Added price for historical record
    description: { type: String }
  },
  taxAmount: { // Renamed from 'tax' for clarity
    type: Number,
    default: 0
  },
  taxRate: { // Added to store the rate at time of purchase
      type: Number,
      default: 0
  },
  discount: {
    type: Number,
    default: 0
  },
  totalAmount: {
    type: Number,
    required: true,
    min: [0, 'Total amount must be greater than 0']
  },
  shippingAddress: {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true }, // Added email to shippingAddress
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    postalCode: String,
    country: { type: String, default: 'Nigeria' },
    phone: { type: String, required: true }
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
  deliveredAt: Date
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

OrderSchema.index({ createdAt: -1, status: 1 });
OrderSchema.index({ 'items.product': 1 });

OrderSchema.pre('save', async function(next) {
  if (!this.orderNumber) {
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
      return next(new Error('Failed to generate unique order number'));
    }
  }

  if (this.isModified('status')) {
    this.timeline.push({
      status: this.status,
      timestamp: Date.now(),
      updatedBy: this.updatedBy || this.user
    });

    if (this.status === 'shipped' && !this.shippedAt) {
      this.shippedAt = Date.now();
    } else if (this.status === 'delivered' && !this.deliveredAt) {
      this.deliveredAt = Date.now();
    }
  }

  next();
});

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
      $lte: endDate
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