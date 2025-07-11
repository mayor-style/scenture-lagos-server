const Product = require('../models/product.model');
const Category = require('../models/category.model');
const Review = require('../models/review.model');
const { ErrorResponse } = require('../middleware/error.middleware');
const { success, error, paginate } = require('../utils/response.util');

/**
 * @desc    Get all products
 * @route   GET /api/v1/products
 * @access  Public
 */
exports.getProducts = async (req, res, next) => {
  try {
    // Pagination
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 12;
    const startIndex = (page - 1) * limit;

    // Build filter object
    const filter = { status: 'active' };

    // Filter by category
    if (req.query.category) {
      // Find the category and its subcategories
      const category = await Category.findOne({ slug: req.query.category });
      
      if (category) {
        // Get all subcategories
        const subcategories = await Category.find({ parent: category._id });
        const categoryIds = [category._id, ...subcategories.map(subcat => subcat._id)];
        
        filter.category = { $in: categoryIds };
      }
    }

    // Filter by featured
    if (req.query.featured === 'true') {
      filter.featured = true;
    }

    // Filter by price range
    if (req.query.minPrice || req.query.maxPrice) {
      filter.price = {};
      
      if (req.query.minPrice) {
        filter.price.$gte = parseFloat(req.query.minPrice);
      }
      
      if (req.query.maxPrice) {
        filter.price.$lte = parseFloat(req.query.maxPrice);
      }
    }

    // Search by name
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      filter.name = searchRegex;
    }

    // Execute query with pagination
    const total = await Product.countDocuments(filter);
    
    // Determine sort order
    let sortBy = {};
    if (req.query.sort) {
      switch (req.query.sort) {
        case 'price-asc':
          sortBy = { price: 1 };
          break;
        case 'price-desc':
          sortBy = { price: -1 };
          break;
        case 'newest':
          sortBy = { createdAt: -1 };
          break;
        case 'rating':
          sortBy = { 'ratings.average': -1 };
          break;
        default:
          sortBy = { createdAt: -1 };
      }
    } else {
      sortBy = { createdAt: -1 };
    }

    const products = await Product.find(filter)
      .select('name slug price description images category ratings stockQuantity')
      .populate('category', 'name slug')
      .sort(sortBy)
      .skip(startIndex)
      .limit(limit);

    return paginate(
      res,
      'Products retrieved successfully',
      products,
      page,
      limit,
      total
    );
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get single product
 * @route   GET /api/v1/products/:slug
 * @access  Public
 */
exports.getProduct = async (req, res, next) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug })
      .populate('category', 'name slug')
      .populate({
        path: 'reviews',
        select: 'rating title comment user createdAt',
        match: { status: 'approved' },
        options: { sort: { createdAt: -1 } },
        populate: {
          path: 'user',
          select: 'firstName lastName'
        }
      });

    if (!product) {
      return next(new ErrorResponse(`Product not found with slug of ${req.params.slug}`, 404));
    }

    // Check if product is active
    if (product.status !== 'active') {
      return next(new ErrorResponse('This product is currently unavailable', 404));
    }

    // Get related products (same category, different product)
    const relatedProducts = await Product.find({
      category: product.category,
      _id: { $ne: product._id },
      status: 'active'
    })
      .select('name slug price images')
      .limit(4);

    return success(res, 'Product retrieved successfully', { 
      product,
      relatedProducts 
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get featured products
 * @route   GET /api/v1/products/featured
 * @access  Public
 */
exports.getFeaturedProducts = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 8;

    const products = await Product.find({ featured: true, status: 'active' })
      .select('name slug price images category')
      .populate('category', 'name slug')
      .sort('-createdAt')
      .limit(limit);

    return success(res, 'Featured products retrieved successfully', { products });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get new arrivals
 * @route   GET /api/v1/products/new-arrivals
 * @access  Public
 */
exports.getNewArrivals = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 8;

    const products = await Product.find({ status: 'active' })
      .select('name slug price images category')
      .populate('category', 'name slug')
      .sort('-createdAt')
      .limit(limit);

    return success(res, 'New arrivals retrieved successfully', { products });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get best selling products
 * @route   GET /api/v1/products/best-selling
 * @access  Public
 */
exports.getBestSellingProducts = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 8;

    const products = await Product.find({ status: 'active' })
      .select('name slug price images category')
      .populate('category', 'name slug')
      .sort('-salesCount')
      .limit(limit);

    return success(res, 'Best selling products retrieved successfully', { products });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get product reviews
 * @route   GET /api/v1/products/:id/reviews
 * @access  Public
 */
exports.getProductReviews = async (req, res, next) => {
  try {
    // Pagination
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;

    // Find product
    const product = await Product.findById(req.params.id);

    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    // Get approved reviews for the product
    const filter = { product: req.params.id, status: 'approved' };
    
    // Filter by rating
    if (req.query.rating) {
      filter.rating = parseInt(req.query.rating, 10);
    }

    // Execute query with pagination
    const total = await Review.countDocuments(filter);
    const reviews = await Review.find(filter)
      .populate({
        path: 'user',
        select: 'firstName lastName'
      })
      .sort('-createdAt')
      .skip(startIndex)
      .limit(limit);

    return paginate(
      res,
      'Product reviews retrieved successfully',
      reviews,
      page,
      limit,
      total
    );
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Create product review
 * @route   POST /api/v1/products/:id/reviews
 * @access  Private/Customer
 */
exports.createProductReview = async (req, res, next) => {
  try {
    const { rating, title, comment } = req.body;

    // Validate input
    if (!rating) {
      return next(new ErrorResponse('Please provide a rating', 400));
    }

    if (rating < 1 || rating > 5) {
      return next(new ErrorResponse('Rating must be between 1 and 5', 400));
    }

    // Find product
    const product = await Product.findById(req.params.id);

    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    // Check if user has already reviewed this product
    const existingReview = await Review.findOne({
      product: req.params.id,
      user: req.user.id
    });

    if (existingReview) {
      return next(new ErrorResponse('You have already reviewed this product', 400));
    }

    // Create review
    const review = await Review.create({
      product: req.params.id,
      user: req.user.id,
      rating,
      title: title || `${rating} star review`,
      comment: comment || '',
      status: 'pending' // Reviews need approval before being published
    });

    return success(res, 'Review submitted successfully and pending approval', { review });
  } catch (err) {
    next(err);
  }
};