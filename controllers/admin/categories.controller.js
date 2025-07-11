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
  console.log('hitted');
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

    console.log('almost', req.body);

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
exports.updateCategory = async (req, res, next) => {
  try {
    let category = await Category.findById(req.params.id);

    if (!category) {
      return next(new ErrorResponse(`Category not found with id of ${req.params.id}`, 404));
    }

    // Check if name is being changed and already exists
    if (req.body.name && req.body.name !== category.name) {
      const existingCategory = await Category.findOne({ name: req.body.name });
      if (existingCategory) {
        return next(new ErrorResponse('Category name already exists', 400));
      }
    }

    // Prevent category from being its own parent
    if (req.body.parent && req.body.parent === req.params.id) {
      return next(new ErrorResponse('Category cannot be its own parent', 400));
    }

    // Validate parent category if provided
    if (req.body.parent) {
      const parentCategory = await Category.findById(req.body.parent);
      if (!parentCategory) {
        return next(new ErrorResponse(`Parent category not found with id of ${req.body.parent}`, 404));
      }

      // Check for circular reference
      let currentParent = parentCategory;
      while (currentParent && currentParent.parent) {
        if (currentParent.parent.toString() === req.params.id) {
          return next(new ErrorResponse('Circular reference detected in category hierarchy', 400));
        }
        currentParent = await Category.findById(currentParent.parent);
      }
    }

    // Update category
    category = await Category.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: Date.now() },
      { new: true, runValidators: true }
    ).populate('parent', 'name');

    return success(res, 'Category updated successfully', { category });
  } catch (err) {
    next(err);
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