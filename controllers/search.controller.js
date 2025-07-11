const Product = require('../models/product.model');
const Category = require('../models/category.model');
const { success } = require('../utils/response.util');

/**
 * @desc    Search products
 * @route   GET /api/v1/search
 * @access  Public
 */
exports.searchProducts = async (req, res, next) => {
  try {
    const { q, category, minPrice, maxPrice, sort, page = 1, limit = 12 } = req.query;

    // Build query
    const query = { status: 'active' };

    // Search term
    if (q) {
      query.$or = [
        { name: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
        { 'variants.size': { $regex: q, $options: 'i' } },
        { 'variants.scentIntensity': { $regex: q, $options: 'i' } }
      ];
    }

    // Category filter
    if (category) {
      // Find the category and all its subcategories
      const categoryObj = await Category.findOne({ slug: category });
      
      if (categoryObj) {
        // Get all subcategories
        const subcategories = await Category.find({ parent: categoryObj._id });
        const categoryIds = [categoryObj._id, ...subcategories.map(sub => sub._id)];
        
        query.category = { $in: categoryIds };
      }
    }

    // Price range
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }

    // Pagination
    const skip = (page - 1) * limit;

    // Sort options
    let sortOptions = {};
    switch (sort) {
      case 'price-asc':
        sortOptions = { price: 1 };
        break;
      case 'price-desc':
        sortOptions = { price: -1 };
        break;
      case 'newest':
        sortOptions = { createdAt: -1 };
        break;
      case 'popular':
        sortOptions = { salesCount: -1 };
        break;
      default:
        sortOptions = { createdAt: -1 };
    }

    // Execute query
    const products = await Product.find(query)
      .populate('category', 'name slug')
      .sort(sortOptions)
      .skip(skip)
      .limit(Number(limit));

    // Get total count
    const total = await Product.countDocuments(query);

    // Calculate pagination info
    const totalPages = Math.ceil(total / limit);
    const hasMore = page < totalPages;

    // Get available filters
    const aggregateFilters = await Product.aggregate([
      { $match: query },
      {
        $facet: {
          categories: [
            { $group: { _id: '$category' } },
            { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'category' } },
            { $unwind: '$category' },
            { $project: { _id: '$category._id', name: '$category.name', slug: '$category.slug' } }
          ],
          priceRange: [
            { $group: { _id: null, min: { $min: '$price' }, max: { $max: '$price' } } }
          ]
        }
      }
    ]);

    const filters = {
      categories: aggregateFilters[0].categories || [],
      priceRange: aggregateFilters[0].priceRange[0] || { min: 0, max: 1000 }
    };

    return success(res, 'Search results retrieved successfully', {
      products,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages,
        hasMore
      },
      filters
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get search suggestions
 * @route   GET /api/v1/search/suggestions
 * @access  Public
 */
exports.getSearchSuggestions = async (req, res, next) => {
  try {
    const { q } = req.query;

    if (!q || q.length < 2) {
      return success(res, 'Search suggestions retrieved', { suggestions: [] });
    }

    // Get product name suggestions
    const productSuggestions = await Product.find(
      { 
        name: { $regex: q, $options: 'i' },
        status: 'active'
      },
      'name slug'
    ).limit(5);

    // Get category suggestions
    const categorySuggestions = await Category.find(
      { name: { $regex: q, $options: 'i' } },
      'name slug'
    ).limit(3);

    // Combine suggestions
    const suggestions = {
      products: productSuggestions.map(p => ({
        id: p._id,
        name: p.name,
        slug: p.slug,
        type: 'product'
      })),
      categories: categorySuggestions.map(c => ({
        id: c._id,
        name: c.name,
        slug: c.slug,
        type: 'category'
      }))
    };

    return success(res, 'Search suggestions retrieved', { suggestions });
  } catch (err) {
    next(err);
  }
};