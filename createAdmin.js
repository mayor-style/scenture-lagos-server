const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/user.model'); // Adjust path to your User model

dotenv.config();

mongoose.connect(process.env.MONGO_URI, {
  
}).then(async () => {
    console.log('Connected to MongoDB');
          const admin = new User({
        firstName: 'Admin',
        lastName: 'User',
        email: 'admin@scenture.com',
        password: 'scenture@1', // Will be hashed by pre-save hook
        role: 'admin',
        phone: '08012345678',
        address: {
            street: '123 Admin Street',
            city: 'Lagos',
            state: 'Lagos',
            postalCode: '100001',
            country: 'Nigeria'
        }
    });
    await admin.save();
    console.log(' New Admin user created:', admin.email);
    mongoose.connection.close();
}).catch(err => {
    console.error('Error:', err);
    mongoose.connection.close();
});