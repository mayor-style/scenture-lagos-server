const Product = require('../models/product.model');
const Category = require('../models/category.model');
const Review = require('../models/review.model');
const Order = require('../models/order.model');
const { ErrorResponse } = require('../middleware/error.middleware');
const { success, paginate } = require('../utils/response.util');

/**
 * @desc    Get all products
 * @route   GET /api/v1/products
 * @access  Public
 */
exports.getProducts = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 12;
    const startIndex = (page - 1) * limit;

    const filter = { status: 'published', images: { $exists: true, $ne: [] } };

  if (req.query.category) {
  if (req.query.category === 'all') {
    const categories = await Category.find();
    const categoryIds = categories.map(cat => cat._id);
    filter.category = { $in: categoryIds };
  } else {
    const category = await Category.findOne({ slug: req.query.category });
    if (!category) {
      return next(new ErrorResponse(`Category not found with slug of ${req.query.category}`, 404));
    }
    const subcategories = await Category.find({ parent: category._id });
    const categoryIds = [category._id, ...subcategories.map(subcat => subcat._id)];
    filter.category = { $in: categoryIds };
  }
}

    if (req.query.featured === 'true') {
      filter.featured = true;
    }

    if (req.query.minPrice || req.query.maxPrice) {
      filter.price = {};
      if (req.query.minPrice) filter.price.$gte = parseFloat(req.query.minPrice);
      if (req.query.maxPrice) filter.price.$lte = parseFloat(req.query.maxPrice);
    }

    if (req.query.search) {
      filter.name = new RegExp(req.query.search, 'i');
    }

    filter.stockQuantity = { $gt: 0 };

    let sortBy = {};
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
        sortBy = { averageRating: -1 };
        break;
      case 'featured':
        sortBy = { featured: -1, createdAt: -1 };
        break;
      default:
        sortBy = { createdAt: -1 };
    }

    const total = await Product.countDocuments(filter);
    const products = await Product.find(filter)
      .select('name slug price images category averageRating stockQuantity scentNotes description')
      .populate('category', 'name slug')
      .sort(sortBy)
      .skip(startIndex)
      .limit(limit)
      .lean();

    if (!products.length && total === 0) {
      return paginate(res, 'No products found matching the criteria', [], page, limit, 0);
    }

    return paginate(res, 'Products retrieved successfully', products, page, limit, total);
  } catch (err) {
    return next(new ErrorResponse(err.message || 'Server error', 500));
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
      .select('name slug status price images category description scentNotes averageRating numReviews stockQuantity')
      .populate('category', 'name slug')
      .lean();

    if (!product) {
      return next(new ErrorResponse(`Product not found with slug of ${req.params.slug}`, 404));
    }

    if (product.status !== 'published') {
      return next(new ErrorResponse('This product is currently unavailable', 404));
    }

    // Enhanced "You Might Also Like" logic: match by category and scent notes
    const relatedFilter = {
      _id: { $ne: product._id },
      status: 'published',
      stockQuantity: { $gt: 0 },
      $or: [
        { category: product.category._id },
        {
          $or: [
            { 'scentNotes.top': { $in: product.scentNotes?.top || [] } },
            { 'scentNotes.middle': { $in: product.scentNotes?.middle || [] } },
            { 'scentNotes.base': { $in: product.scentNotes?.base || [] } },
          ],
        },
      ],
    };

    let relatedProducts = await Product.find(relatedFilter)
      .select('name slug price images category')
      .populate('category', 'name slug')
      .sort({ featured: -1, createdAt: -1 })
      .limit(4)
      .lean();

    // If fewer than 4 related products, fill with featured products
    if (relatedProducts.length < 4) {
      const additionalLimit = 4 - relatedProducts.length;
      const additionalProducts = await Product.find({
        _id: { $ne: product._id, $nin: relatedProducts.map((p) => p._id) },
        status: 'published',
        stockQuantity: { $gt: 0 },
        featured: true,
      })
        .select('name slug price images category')
        .populate('category', 'name slug')
        .sort({ createdAt: -1 })
        .limit(additionalLimit)
        .lean();
      relatedProducts = [...relatedProducts, ...additionalProducts];
    }

    // Ensure exactly 4 related products by filling with newest products if needed
    if (relatedProducts.length < 4) {
      const additionalLimit = 4 - relatedProducts.length;
      const additionalProducts = await Product.find({
        _id: { $ne: product._id, $nin: relatedProducts.map((p) => p._id) },
        status: 'published',
        stockQuantity: { $gt: 0 },
      })
        .select('name slug price images category')
        .populate('category', 'name slug')
        .sort({ createdAt: -1 })
        .limit(additionalLimit)
        .lean();
      relatedProducts = [...relatedProducts, ...additionalProducts];
    }

    return success(res, 'Product retrieved successfully', { product, relatedProducts });
  } catch (err) {
    next(new ErrorResponse(err.message || 'Server error', 500));
  }
};

/**
 * @desc    Get featured products
 * @route   GET /api/v1/products/featured
 * @access  Public
 */
exports.getFeaturedProducts = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 4;
    let products = await Product.find({
      featured: true,
      status: 'published',
      stockQuantity: { $gt: 0 },
      images: { $exists: true, $ne: [] },
    })
      .select('name slug price images category averageRating stockQuantity')
      .populate('category', 'name slug')
      .sort('-createdAt')
      .limit(limit)
      .lean();

    if (products.length < limit) {
      const additionalLimit = limit - products.length;
      const additionalProducts = await Product.find({
        featured: { $ne: true },
        status: 'published',
        stockQuantity: { $gt: 0 },
        images: { $exists: true, $ne: [] },
        _id: { $nin: products.map((p) => p._id) },
      })
        .select('name slug price images category averageRating stockQuantity')
        .populate('category', 'name slug')
        .sort('-createdAt')
        .limit(additionalLimit)
        .lean();
      products = [...products, ...additionalProducts];
    }

    return success(res, 'Featured products retrieved successfully', { products });
  } catch (err) {
    next(new ErrorResponse(err.message || 'Server error', 500));
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
    const days = parseInt(req.query.days, 10) || 30;

    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - days);

    const products = await Product.find({
      status: 'published',
      stockQuantity: { $gt: 0 },
      images: { $exists: true, $ne: [] },
      createdAt: { $gte: dateThreshold },
    })
      .select('name slug price images category averageRating')
      .populate('category', 'name slug')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    if (!products.length) {
      return success(res, 'No new arrivals found', { products: [] });
    }

    return success(res, 'New arrivals retrieved successfully', { products });
  } catch (err) {
    return next(new ErrorResponse(err.message || 'Server error', 500));
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
    const days = parseInt(req.query.days, 10) || 30;

    const dateThreshold = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;

    const salesData = await Order.aggregate([
      { $match: dateThreshold ? { createdAt: { $gte: dateThreshold }, 'paymentInfo.status': 'paid' } : { 'paymentInfo.status': 'paid' } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          numSales: { $sum: '$items.quantity' },
        },
      },
      { $sort: { numSales: -1 } },
      { $limit: limit },
    ]);

    const productIds = salesData.map((item) => item._id);

    const products = await Product.find({
      _id: { $in: productIds },
      status: 'published',
      stockQuantity: { $gt: 0 },
      images: { $exists: true, $ne: [] },
    })
      .select('name slug price images category averageRating')
      .populate('category', 'name slug')
      .lean();

    const productsWithSales = productIds
      .map((id) => {
        const product = products.find((p) => p._id.toString() === id.toString());
        if (product) {
          const sales = salesData.find((s) => s._id.toString() === id.toString());
          return { ...product, numSales: sales.numSales };
        }
        return null;
      })
      .filter((p) => p);

    if (!productsWithSales.length) {
      return success(res, 'No best-selling products found', { products: [] });
    }

    return success(res, 'Best selling products retrieved successfully', { products: productsWithSales });
  } catch (err) {
    return next(new ErrorResponse(err.message || 'Server error', 500));
  }
};

/**
 * @desc    Get product reviews
 * @route   GET /api/v1/products/:id/reviews
 * @access  Public
 */
exports.getProductReviews = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;

    const product = await Product.findById(req.params.id);
    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    const filter = { product: req.params.id, status: 'approved' };
    if (req.query.rating) {
      filter.rating = parseInt(req.query.rating, 10);
    }

    const total = await Review.countDocuments(filter);
    const reviews = await Review.find(filter)
      .populate({
        path: 'user',
        select: 'firstName lastName',
      })
      .sort('-createdAt')
      .skip(startIndex)
      .limit(limit)
      .lean();

    return paginate(res, 'Product reviews retrieved successfully', reviews, page, limit, total);
  } catch (err) {
    next(new ErrorResponse(err.message || 'Server error', 500));
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

    if (!rating) {
      return next(new ErrorResponse('Please provide a rating', 400));
    }

    if (rating < 1 || rating > 5) {
      return next(new ErrorResponse('Rating must be between 1 and 5', 400));
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    const existingReview = await Review.findOne({
      product: req.params.id,
      user: req.user.id,
    });

    if (existingReview) {
      return next(new ErrorResponse('You have already reviewed this product', 400));
    }

    const review = await Review.create({
      product: req.params.id,
      user: req.user.id,
      rating,
      title: title || `${rating} star review`,
      comment: comment || '',
      status: 'pending',
    });

    return success(res, 'Review submitted successfully and pending approval', { review });
  } catch (err) {
    next(new ErrorResponse(err.message || 'Server error', 500));
  }
};