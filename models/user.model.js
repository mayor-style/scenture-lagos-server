// In user.model.js

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const UserSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'Please add a first name'],
    trim: true,
    maxlength: [50, 'First name cannot be more than 50 characters'],
  },
  lastName: {
    type: String,
    required: [true, 'Please add a last name'],
    trim: true,
    maxlength: [50, 'Last name cannot be more than 50 characters'],
  },
  email: {
    type: String,
    required: [true, 'Please add an email'],
    unique: true,
    lowercase: true, // Store emails in lowercase to ensure uniqueness across case
    match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please add a valid email'],
  },
  phone: {
    type: String,
    trim: true,
  },
  role: {
    type: String,
    enum: ['customer', 'admin', 'superadmin'],
    default: 'customer',
  },
  password: {
    type: String,
    required: [true, 'Please add a password'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false,
  },
  address: {
    street: { type: String, trim: true }, // Made optional, adjust as per your app's logic
    city: { type: String, trim: true },   // Made optional
    state: { type: String, trim: true },  // Made optional
    postalCode: { type: String, trim: true },
    country: { type: String, default: 'Nigeria', trim: true },
  },
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  active: {
    type: Boolean,
    default: true,
  },
  isVip: {
    type: Boolean,
    default: false,
  },
  isFlagged: {
    type: Boolean,
    default: false,
  },
  notes: [
    {
      content: { type: String, required: true },
      createdBy: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
      createdAt: { type: Date, default: Date.now },
    },
  ],
  lastLogin: Date,
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
  timestamps: true // Add createdAt and updatedAt timestamps automatically
});

// Indexes for performance
UserSchema.index({ createdAt: -1, role: 1 });
UserSchema.index({ firstName: 1, lastName: 1 }); // Index for searching by name

UserSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

UserSchema.virtual('orders', {
  ref: 'Order',
  localField: '_id',
  foreignField: 'user',
  justOne: false,
});

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

UserSchema.methods.getSignedJwtToken = function () {
  return jwt.sign({ id: this._id, role: this.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });
};

UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

UserSchema.methods.getResetPasswordToken = function () {
  const resetToken = crypto.randomBytes(20).toString('hex');
  this.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  this.resetPasswordExpire = Date.now() + 10 * 60 * 1000;
  return resetToken;
};

module.exports = mongoose.model('User', UserSchema);