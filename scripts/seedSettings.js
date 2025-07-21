// scripts/seedSettings.js
const mongoose = require('mongoose');
const Settings = require('../models/settings.model');

async function seedSettings() {
  try {
    await mongoose.connect('mongodb+srv://slickoutlaw001:SCEjB0EjsR2g4AiA@scenture.g7rf5ft.mongodb.net/?retryWrites=true&w=majority&appName=scenture', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const defaultSettings = {
      storeName: 'Scenture Lagos',
      storeAddress: { country: 'Nigeria' },
      currency: { code: 'NGN', symbol: '₦' },
      tax: { enabled: false, rate: 0, includeInPrice: false },
      payment: { defaultMethod: 'paystack', methods: [] },
      emailNotifications: {
        orderConfirmation: true,
        orderStatusUpdate: true,
        orderShipped: true,
        lowStockAlert: true,
      },
      lowStockThreshold: 5,
      shipping: {
        zones: [
          {
            name: 'Lagos Local',
            regions: ['Lagos'],
            rate: 1500,
            freeShippingThreshold: 50000,
            estimatedDelivery: '1-2 business days',
            active: true,
          },
          {
            name: 'Nationwide',
            regions: ['Abuja', 'Rivers', 'Ogun', 'Oyo', 'Others'],
            rate: 5000,
            freeShippingThreshold: 100000,
            estimatedDelivery: '3-5 business days',
            active: true,
          },
        ],
      },
    };

    await Settings.deleteMany({});
    await Settings.create(defaultSettings);
    console.log('Default settings seeded successfully');
    mongoose.connection.close();
  } catch (error) {
    console.error('Error seeding settings:', error);
    mongoose.connection.close();
  }
}

seedSettings();