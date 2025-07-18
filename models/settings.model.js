const mongoose = require('mongoose');

// Shipping Zone Schema (subdocument)
const ShippingZoneSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a zone name'],
    trim: true
  },
  regions: [{
    type: String,
    required: [true, 'Please add at least one region']
  }],
  rate: {
    type: Number,
    required: [true, 'Please add a shipping rate'],
    min: [0, 'Shipping rate cannot be negative']
  },
  freeShippingThreshold: {
    type: Number,
    default: 0
  },
  active: {
    type: Boolean,
    default: true
  }
});

// Payment Method Schema (subdocument)
const PaymentMethodSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a payment method name'],
    enum: ['paystack', 'bank_transfer', 'cash_on_delivery']
  },
  displayName: {
    type: String,
    required: [true, 'Please add a display name']
  },
  description: String,
  instructions: String,
  config: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  active: {
    type: Boolean,
    default: true
  }
});

// Settings Schema
const SettingsSchema = new mongoose.Schema({
  storeName: {
    type: String,
    default: 'Scenture Lagos'
  },
  storeEmail: {
    type: String,
    required: [true, 'Please add a store email']
  },
  storePhone: String,
  storeAddress: {
    street: String,
    city: String,
    state: String,
    postalCode: String,
    country: {
      type: String,
      default: 'Nigeria'
    }
  },
  logo: String,
  favicon: String,
  socialMedia: {
    instagram: String,
    facebook: String,
    twitter: String
  },
  currency: {
    code: {
      type: String,
      default: 'NGN'
    },
    symbol: {
      type: String,
      default: '₦'
    }
  },
  tax: {
    enabled: {
      type: Boolean,
      default: false
    },
    rate: {
      type: Number,
      default: 0
    },
    includeInPrice: {
      type: Boolean,
      default: false
    }
  },
  shipping: {
    zones: [ShippingZoneSchema],
    defaultZone: {
      type: mongoose.Schema.ObjectId,
      ref: 'ShippingZone'
    }
  },
  payment: {
    methods: [PaymentMethodSchema],
    defaultMethod: {
      type: String,
      enum: ['paystack', 'bank_transfer', 'cash_on_delivery'],
      default: 'paystack'
    }
  },
  emailNotifications: {
    orderConfirmation: {
      type: Boolean,
      default: true
    },
    orderStatusUpdate: {
      type: Boolean,
      default: true
    },
    orderShipped: {
      type: Boolean,
      default: true
    },
    lowStockAlert: {
      type: Boolean,
      default: true
    }
  },
  lowStockThreshold: {
    type: Number,
    default: 5
  },
  updatedBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Ensure only one settings document exists
SettingsSchema.pre('save', async function(next) {
  const count = await this.constructor.countDocuments();
  if (count > 0 && this.isNew) {
    const error = new Error('Only one settings document can exist');
    return next(error);
  }
  
  // Update the updatedAt field
  this.updatedAt = Date.now();
  
  next();
});

// Static method to get settings (creates default if none exist)
SettingsSchema.statics.getSettings = async function() {
  let settings = await this.findOne();
  
  if (!settings) {
    // Create default settings
    settings = await this.create({
      storeName: 'Scenture Lagos',
      storeEmail: 'info@scenture.com',
      currency: {
        code: 'NGN',
        symbol: '₦'
      },
      payment: {
        methods: [
          {
            name: 'paystack',
            displayName: 'Pay with Card',
            description: 'Pay securely with your credit/debit card',
            active: true
          },
          {
            name: 'bank_transfer',
            displayName: 'Bank Transfer',
            description: 'Make a direct bank transfer',
            instructions: 'Please transfer the total amount to the following account...',
            active: true
          },
          {
            name: 'cash_on_delivery',
            displayName: 'Cash on Delivery',
            description: 'Pay when you receive your order',
            active: true
          }
        ],
        defaultMethod: 'paystack'
      }
    });
  }
  
  return settings;
};

module.exports = mongoose.model('Settings', SettingsSchema);