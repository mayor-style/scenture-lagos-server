const User = require('../models/user.model');
const Order = require('../models/order.model');
const Product = require('../models/product.model');
const { ErrorResponse } = require('../middleware/error.middleware');
const { success, error, paginate } = require('../utils/response.util');
const { validateEmail, validatePassword } = require('../utils/validator.util');

/**
 * @desc    Register customer
 * @route   POST /api/v1/customer/register
 * @access  Public
 */
exports.register = async (req, res, next) => {
  try {
    const { firstName, lastName, email, password, phone } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email || !password) {
      return next(new ErrorResponse('Please provide all required fields', 400));
    }

    // Validate email format
    if (!validateEmail(email)) {
      return next(new ErrorResponse('Please provide a valid email', 400));
    }

    // Validate password strength
    if (!validatePassword(password)) {
      return next(
        new ErrorResponse(
          'Password must be at least 8 characters long and include at least one uppercase letter, one lowercase letter, one number, and one special character',
          400
        )
      );
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return next(new ErrorResponse('Email already in use', 400));
    }

    // Create user
    const user = await User.create({
      firstName,
      lastName,
      email,
      password,
      phone,
      role: 'customer'
    });

    // Generate token
    const token = user.getSignedJwtToken();

    // Remove password from response
    user.password = undefined;

    // Set cookie
    const options = {
      expires: new Date(
        Date.now() + process.env.JWT_COOKIE_EXPIRE * 24 * 60 * 60 * 1000
      ),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production'
    };

    return res
      .status(201)
      .cookie('token', token, options)
      .json({
        success: true,
        message: 'Registration successful',
        data: {
          user,
          token
        }
      });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get customer profile
 * @route   GET /api/v1/customer/profile
 * @access  Private/Customer
 */
exports.getProfile = async (req, res, next) => {
  try {
    // Get user from database with fresh data
    const user = await User.findById(req.user.id).select('-password');

    if (!user) {
      return next(new ErrorResponse('User not found', 404));
    }

    return success(res, 'Profile retrieved successfully', { user });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Update customer profile
 * @route   PUT /api/v1/customer/profile
 * @access  Private/Customer
 */
exports.updateProfile = async (req, res, next) => {
  try {
    // Fields to update
    const fieldsToUpdate = {};
    
    // Only update fields that were actually passed
    const updateableFields = ['firstName', 'lastName', 'phone', 'address'];
    updateableFields.forEach(field => {
      if (req.body[field] !== undefined) {
        fieldsToUpdate[field] = req.body[field];
      }
    });

    // Update user
    const user = await User.findByIdAndUpdate(
      req.user.id,
      fieldsToUpdate,
      { new: true, runValidators: true }
    ).select('-password');

    return success(res, 'Profile updated successfully', { user });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get customer orders
 * @route   GET /api/v1/customer/orders
 * @access  Private/Customer
 */
exports.getOrders = async (req, res, next) => {
  try {
    // Pagination
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;

    // Build filter object
    const filter = { user: req.user.id };

    // Filter by status
    if (req.query.status && ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'].includes(req.query.status)) {
      filter.status = req.query.status;
    }

    // Execute query with pagination
    const total = await Order.countDocuments(filter);
    const orders = await Order.find(filter)
      .sort('-createdAt')
      .skip(startIndex)
      .limit(limit);

    return paginate(
      res,
      'Orders retrieved successfully',
      orders,
      page,
      limit,
      total
    );
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get single order
 * @route   GET /api/v1/customer/orders/:id
 * @access  Private/Customer
 */
exports.getOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return next(new ErrorResponse(`Order not found with id of ${req.params.id}`, 404));
    }

    // Make sure the order belongs to the customer
    if (order.user.toString() !== req.user.id) {
      return next(new ErrorResponse('Not authorized to access this order', 401));
    }

    return success(res, 'Order retrieved successfully', { order });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get recently viewed products
 * @route   GET /api/v1/customer/recently-viewed
 * @access  Private/Customer
 */
exports.getRecentlyViewed = async (req, res, next) => {
  try {
    // Get user with populated recentlyViewed
    const user = await User.findById(req.user.id)
      .select('recentlyViewed')
      .populate({
        path: 'recentlyViewed',
        select: 'name slug price images category',
        populate: {
          path: 'category',
          select: 'name slug'
        }
      });

    if (!user) {
      return next(new ErrorResponse('User not found', 404));
    }

    return success(res, 'Recently viewed products retrieved successfully', {
      products: user.recentlyViewed || []
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Add product to recently viewed
 * @route   POST /api/v1/customer/recently-viewed
 * @access  Private/Customer
 */
exports.addToRecentlyViewed = async (req, res, next) => {
  try {
    const { productId } = req.body;

    if (!productId) {
      return next(new ErrorResponse('Please provide a product ID', 400));
    }

    // Check if product exists
    const product = await Product.findById(productId);

    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${productId}`, 404));
    }

    // Get user
    const user = await User.findById(req.user.id);

    if (!user) {
      return next(new ErrorResponse('User not found', 404));
    }

    // Initialize recentlyViewed array if it doesn't exist
    if (!user.recentlyViewed) {
      user.recentlyViewed = [];
    }

    // Remove product if it already exists in the array
    user.recentlyViewed = user.recentlyViewed.filter(
      id => id.toString() !== productId
    );

    // Add product to the beginning of the array
    user.recentlyViewed.unshift(productId);

    // Limit to 10 most recent products
    if (user.recentlyViewed.length > 10) {
      user.recentlyViewed = user.recentlyViewed.slice(0, 10);
    }

    await user.save({ validateBeforeSave: false });

    return success(res, 'Product added to recently viewed', {
      recentlyViewed: user.recentlyViewed
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get customer wishlist
 * @route   GET /api/v1/customer/wishlist
 * @access  Private/Customer
 */
exports.getWishlist = async (req, res, next) => {
  try {
    // Get user with populated wishlist
    const user = await User.findById(req.user.id)
      .select('wishlist')
      .populate({
        path: 'wishlist',
        select: 'name slug price images category stockQuantity',
        populate: {
          path: 'category',
          select: 'name slug'
        }
      });

    if (!user) {
      return next(new ErrorResponse('User not found', 404));
    }

    return success(res, 'Wishlist retrieved successfully', {
      products: user.wishlist || []
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Add product to wishlist
 * @route   POST /api/v1/customer/wishlist
 * @access  Private/Customer
 */
exports.addToWishlist = async (req, res, next) => {
  try {
    const { productId } = req.body;

    if (!productId) {
      return next(new ErrorResponse('Please provide a product ID', 400));
    }

    // Check if product exists
    const product = await Product.findById(productId);

    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${productId}`, 404));
    }

    // Get user
    const user = await User.findById(req.user.id);

    if (!user) {
      return next(new ErrorResponse('User not found', 404));
    }

    // Initialize wishlist array if it doesn't exist
    if (!user.wishlist) {
      user.wishlist = [];
    }

    // Check if product is already in wishlist
    if (user.wishlist.includes(productId)) {
      return next(new ErrorResponse('Product already in wishlist', 400));
    }

    // Add product to wishlist
    user.wishlist.push(productId);

    await user.save({ validateBeforeSave: false });

    return success(res, 'Product added to wishlist', {
      wishlist: user.wishlist
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Remove product from wishlist
 * @route   DELETE /api/v1/customer/wishlist/:id
 * @access  Private/Customer
 */
exports.removeFromWishlist = async (req, res, next) => {
  try {
    const productId = req.params.id;

    // Get user
    const user = await User.findById(req.user.id);

    if (!user) {
      return next(new ErrorResponse('User not found', 404));
    }

    // Check if wishlist exists
    if (!user.wishlist) {
      return next(new ErrorResponse('Wishlist is empty', 400));
    }

    // Check if product is in wishlist
    if (!user.wishlist.includes(productId)) {
      return next(new ErrorResponse('Product not in wishlist', 400));
    }

    // Remove product from wishlist
    user.wishlist = user.wishlist.filter(
      id => id.toString() !== productId
    );

    await user.save({ validateBeforeSave: false });

    return success(res, 'Product removed from wishlist', {
      wishlist: user.wishlist
    });
  } catch (err) {
    next(err);
  }
};