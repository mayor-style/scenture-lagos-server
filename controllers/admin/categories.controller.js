const Category = require('../../models/category.model');
const Product = require('../../models/product.model');
const { ErrorResponse } = require('../../middleware/error.middleware');
const { success, paginate } = require('../../utils/response.util');

/**
 * @desc    Get all categories
 * @route   GET /api/v1/admin/categories
 * @access  Private/Admin
 */
exports.getCategories = async (req, res, next) => {
  try {
    console.log('Fetching categories with query:', req.query);
    if (req.query.tree === 'true') {
      const categoryTree = await Category.getCategoryTree();
      return success(res, 'Categories retrieved successfully', { categories: categoryTree || [] });
    }

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;

    const filter = {};

    if (req.query.parent) {
      filter.parent = req.query.parent === 'null' ? null : req.query.parent;
    }

    if (req.query.featured) {
      filter.featured = req.query.featured === 'true';
    }

    if (req.query.search) {
      filter.name = new RegExp(req.query.search, 'i');
    }

    const total = await Category.countDocuments(filter);
    const categories = await Category.find(filter)
      .populate('parent', 'name')
      .sort(req.query.sort || 'name')
      .skip(startIndex)
      .limit(limit);

    // Get product and subcategory counts for each category
    const categoryIds = categories.map(category => category._id);
    
    // Get product counts for all categories in one query
    const productCounts = await Product.aggregate([
      { $match: { category: { $in: categoryIds } } },
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]);
    
    // Get subcategory counts for all categories in one query
    const subcategoryCounts = await Category.aggregate([
      { $match: { parent: { $in: categoryIds } } },
      { $group: { _id: '$parent', count: { $sum: 1 } } }
    ]);
    
    // Create lookup maps for faster access
    const productCountMap = productCounts.reduce((map, item) => {
      map[item._id.toString()] = item.count;
      return map;
    }, {});
    
    const subcategoryCountMap = subcategoryCounts.reduce((map, item) => {
      map[item._id.toString()] = item.count;
      return map;
    }, {});
    
    // Format categories to match frontend expectations
    const formattedCategories = categories.map(category => {
      const categoryId = category._id.toString();
      return {
        _id: category._id,
        id: category._id,
        name: category.name,
        slug: category.slug,
        description: category.description || '',
        parent: category.parent ? category.parent._id : null,
        parentName: category.parent ? category.parent.name : null,
        featured: category.featured,
        productCount: productCountMap[categoryId] || 0,
        subcategoryCount: subcategoryCountMap[categoryId] || 0
      };
    });

    return paginate(
      res,
      'Categories retrieved successfully',
      formattedCategories,
      page,
      limit,
      total
    );
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get single category
 * @route   GET /api/v1/admin/categories/:id
 * @access  Private/Admin
 */
exports.getCategory = async (req, res, next) => {
  console.log('Fetching category with ID🔥🔥🔥:', req.params.id);
  try {
    const category = await Category.findById(req.params.id).populate('parent', 'name');

    if (!category) {
      return next(new ErrorResponse(`Category not found with id of ${req.params.id}`, 404));
    }

    // Get product count for this category
    const productCount = await Product.countDocuments({ category: req.params.id });

    // Get subcategories count
    const subcategoriesCount = await Category.countDocuments({ parent: req.params.id });

    return success(res, 'Category retrieved successfully', { 
      category,
      productCount,
      subcategoriesCount
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Create new category
 * @route   POST /api/v1/admin/categories
 * @access  Private/Admin
 */
exports.createCategory = async (req, res, next) => {
  try {
    // Add user to req.body
    req.body.createdBy = req.user.id;

    // Validate required fields
    if (!req.body.name) {
      return next(new ErrorResponse('Please add a category name', 400));
    }

    // Check if name already exists
    const existingCategory = await Category.findOne({ name: req.body.name });
    if (existingCategory) {
      return next(new ErrorResponse('Category name already exists', 400));
    }

    // Validate parent category if provided
    if (req.body.parent) {
      const parentCategory = await Category.findById(req.body.parent);
      if (!parentCategory) {
        return next(new ErrorResponse(`Parent category not found with id of ${req.body.parent}`, 404));
      }
    }


    // Create category
    const category = await Category.create(req.body);

    return success(res, 'Category created successfully', { category }, 201);
  } catch (err) {
    console.error('Error creating category:', err.stack);
    next(err);
  }
};

/**
 * @desc    Update category
 * @route   PUT /api/v1/admin/categories/:id
 * @access  Private/Admin
 */
// Update category endpoint
exports.updateCategory = async (req, res, next) => {
  try {
    // Find category by ID
    const category = await Category.findById(req.params.id);
    if (!category) {
      return next(new ErrorResponse(`Category not found with id of ${req.params.id}`, 404));
    }

    // Validate name uniqueness if changed
    if (req.body.name && req.body.name !== category.name) {
      const existingCategory = await Category.findOne({
        name: req.body.name,
        _id: { $ne: req.params.id }, // Exclude current category
      });
      if (existingCategory) {
        return next(new ErrorResponse('Category name already exists', 400));
      }
    }

    // Prevent category from being its own parent
    if (req.body.parent && req.body.parent.toString() === req.params.id) {
      return next(new ErrorResponse('Category cannot be its own parent', 400));
    }

    // Validate parent category if provided
    if (req.body.parent) {
      const parentCategory = await Category.findById(req.body.parent);
      if (!parentCategory) {
        return next(new ErrorResponse(`Parent category not found with id of ${req.body.parent}`, 404));
      }

      // Check for circular reference
      let currentParentId = parentCategory._id;
      const visited = new Set();
      while (currentParentId) {
        if (visited.has(currentParentId.toString())) {
          return next(new ErrorResponse('Circular reference detected in category hierarchy', 400));
        }
        visited.add(currentParentId.toString());
        if (currentParentId.toString() === req.params.id) {
          return next(new ErrorResponse('Circular reference detected: Category cannot be an ancestor of itself', 400));
        }
        const parent = await Category.findById(currentParentId);
        currentParentId = parent ? parent.parent : null;
      }
    }

    // Prepare update data
    const updateData = {
      ...req.body,
      updatedAt: Date.now(),
    };

    // Update category with validation
    const updatedCategory = await Category.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true, // Return updated document
        runValidators: true, // Run schema validators
        context: 'query', // Ensure validators run in query context
      }
    ).populate('parent', 'name slug');

    if (!updatedCategory) {
      return next(new ErrorResponse('Failed to update category', 500));
    }

    return success(res, 'Category updated successfully', { category: updatedCategory });
  } catch (err) {
    // Handle specific validation errors
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map((val) => val.message);
      return next(new ErrorResponse(messages.join(', '), 400));
    }
    next(new ErrorResponse(err.message || 'Server error', 500));
  }
};

/**
 * @desc    Delete category
 * @route   DELETE /api/v1/admin/categories/:id
 * @access  Private/Admin
 */
exports.deleteCategory = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id);

    if (!category) {
      return next(new ErrorResponse(`Category not found with id of ${req.params.id}`, 404));
    }

    // Check if category has products
    const productCount = await Product.countDocuments({ category: req.params.id });
    if (productCount > 0) {
      return next(new ErrorResponse(`Cannot delete category with ${productCount} associated products`, 400));
    }

    // Check if category has subcategories
    const subcategoriesCount = await Category.countDocuments({ parent: req.params.id });
    if (subcategoriesCount > 0) {
      return next(new ErrorResponse(`Cannot delete category with ${subcategoriesCount} subcategories`, 400));
    }

    await category.deleteOne();

    return success(res, 'Category deleted successfully');
  } catch (err) {
    next(err);
  }
};