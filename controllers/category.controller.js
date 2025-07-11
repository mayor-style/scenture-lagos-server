const Category = require('../models/category.model');
const Product = require('../models/product.model');
const { ErrorResponse } = require('../middleware/error.middleware');
const { success, error } = require('../utils/response.util');

/**
 * @desc    Get all categories
 * @route   GET /api/v1/categories
 * @access  Public
 */
exports.getCategories = async (req, res, next) => {
  try {
    // Check if tree structure is requested
    const isTree = req.query.tree === 'true';

    if (isTree) {
      // Get categories in tree structure
      const categoryTree = await Category.getCategoryTree();
      return success(res, 'Categories retrieved successfully', { categories: categoryTree });
    } else {
      // Build filter object
      const filter = {};

      // Filter by parent
      if (req.query.parent) {
        if (req.query.parent === 'root') {
          // Get root categories (no parent)
          filter.parent = { $exists: false };
        } else {
          // Get subcategories of a specific parent
          const parentCategory = await Category.findOne({ slug: req.query.parent });
          if (parentCategory) {
            filter.parent = parentCategory._id;
          }
        }
      }

      // Filter by featured
      if (req.query.featured === 'true') {
        filter.featured = true;
      }

      // Get categories
      const categories = await Category.find(filter)
        .populate('parent', 'name slug')
        .sort('name');

      return success(res, 'Categories retrieved successfully', { categories });
    }
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get single category
 * @route   GET /api/v1/categories/:slug
 * @access  Public
 */
exports.getCategory = async (req, res, next) => {
  try {
    const category = await Category.findOne({ slug: req.params.slug })
      .populate('parent', 'name slug');

    if (!category) {
      return next(new ErrorResponse(`Category not found with slug of ${req.params.slug}`, 404));
    }

    // Get subcategories
    const subcategories = await Category.find({ parent: category._id })
      .select('name slug image')
      .sort('name');

    // Get category products with pagination
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 12;
    const startIndex = (page - 1) * limit;

    // Build filter for products
    const filter = { 
      category: category._id,
      status: 'active'
    };

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

    // Count total products
    const total = await Product.countDocuments(filter);

    // Get products
    const products = await Product.find(filter)
      .select('name slug price images ratings stockQuantity')
      .sort(sortBy)
      .skip(startIndex)
      .limit(limit);

    // Prepare pagination
    const pagination = {};

    if (startIndex + limit < total) {
      pagination.next = {
        page: page + 1,
        limit
      };
    }

    if (startIndex > 0) {
      pagination.prev = {
        page: page - 1,
        limit
      };
    }

    return success(res, 'Category retrieved successfully', {
      category,
      subcategories,
      products,
      pagination,
      total,
      page,
      limit
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get featured categories
 * @route   GET /api/v1/categories/featured
 * @access  Public
 */
exports.getFeaturedCategories = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 6;

    const categories = await Category.find({ featured: true })
      .select('name slug image')
      .sort('name')
      .limit(limit);

    return success(res, 'Featured categories retrieved successfully', { categories });
  } catch (err) {
    next(err);
  }
};