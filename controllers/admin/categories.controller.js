const Category = require('../../models/category.model');
const Product = require('../../models/product.model');
const { ErrorResponse } = require('../../middleware/error.middleware');
const { success, paginate } = require('../../utils/response.util');

/**
 * @desc      Get all categories
 * @route     GET /api/v1/admin/categories
 * @access    Private/Admin
 */
exports.getCategories = async (req, res, next) => {
  try {
    // Return the full category tree if requested
    if (req.query.tree === 'true') {
      const categoryTree = await Category.getCategoryTree();
      return success(res, 'Categories retrieved successfully', { categories: categoryTree || [] });
    }

    // Standard paginated and filtered list
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
      .limit(limit)
      .lean(); // OPTIMIZATION: Use .lean() for faster queries

    // Get product and subcategory counts efficiently
    const categoryIds = categories.map(category => category._id);

    const [productCounts, subcategoryCounts] = await Promise.all([
      Product.aggregate([
        { $match: { category: { $in: categoryIds } } },
        { $group: { _id: '$category', count: { $sum: 1 } } }
      ]),
      Category.aggregate([
        { $match: { parent: { $in: categoryIds } } },
        { $group: { _id: '$parent', count: { $sum: 1 } } }
      ])
    ]);

    // Create lookup maps for fast merging
    const productCountMap = new Map(productCounts.map(item => [item._id.toString(), item.count]));
    const subcategoryCountMap = new Map(subcategoryCounts.map(item => [item._id.toString(), item.count]));

    // Format categories to match frontend expectations
    const formattedCategories = categories.map(category => {
      const categoryId = category._id.toString();
      return {
        ...category, // Includes _id, name, slug, description, featured
        id: category._id, // Keep `id` for backward compatibility if needed
        parent: category.parent ? category.parent._id : null,
        parentName: category.parent ? category.parent.name : null,
        productCount: productCountMap.get(categoryId) || 0,
        subcategoryCount: subcategoryCountMap.get(categoryId) || 0
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
 * @desc      Get single category
 * @route     GET /api/v1/admin/categories/:id
 * @access    Private/Admin
 */
exports.getCategory = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id).populate('parent', 'name slug').lean();

    if (!category) {
      return next(new ErrorResponse(`Category not found with id of ${req.params.id}`, 404));
    }

    // OPTIMIZATION: Run count queries in parallel
    const [productCount, subcategoryCount] = await Promise.all([
      Product.countDocuments({ category: req.params.id }),
      Category.countDocuments({ parent: req.params.id })
    ]);
    
    // CORRECTION: Format response for consistency with the getCategories list endpoint
    const formattedCategory = {
        ...category,
        id: category._id,
        parent: category.parent ? category.parent._id : null,
        parentName: category.parent ? category.parent.name : null,
        productCount,
        subcategoryCount
    };

    return success(res, 'Category retrieved successfully', {
      category: formattedCategory
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc      Create new category
 * @route     POST /api/v1/admin/categories
 * @access    Private/Admin
 */
exports.createCategory = async (req, res, next) => {
  try {
    req.body.createdBy = req.user.id;

    if (!req.body.name) {
      return next(new ErrorResponse('Please add a category name', 400));
    }
    
    // The unique index on `name` in the schema will handle this check,
    // but a manual check provides a friendlier error message.
    const existingCategory = await Category.findOne({ name: req.body.name }).lean();
    if (existingCategory) {
      return next(new ErrorResponse('Category name already exists', 400));
    }

    if (req.body.parent) {
      const parentCategory = await Category.findById(req.body.parent);
      if (!parentCategory) {
        return next(new ErrorResponse(`Parent category not found with id of ${req.body.parent}`, 404));
      }
    }

    const category = await Category.create(req.body);

    return success(res, 'Category created successfully', { category }, 201);
  } catch (err) {
    // Handle potential duplicate key error from the database
    if (err.code === 11000) {
        return next(new ErrorResponse('Category name already exists', 400));
    }
    next(err);
  }
};

/**
 * @desc      Update category
 * @route     PUT /api/v1/admin/categories/:id
 * @access    Private/Admin
 */
exports.updateCategory = async (req, res, next) => {
  try {
    const categoryId = req.params.id;
    const { parent: newParentId } = req.body;
    
    let category = await Category.findById(categoryId);
    if (!category) {
      return next(new ErrorResponse(`Category not found with id of ${categoryId}`, 404));
    }

    // Prevent category from being its own parent
    if (newParentId && newParentId.toString() === categoryId) {
      return next(new ErrorResponse('A category cannot be its own parent', 400));
    }

    // OPTIMIZATION: Efficiently check for circular references
    if (newParentId) {
      const parentCategory = await Category.findById(newParentId);
      if (!parentCategory) {
        return next(new ErrorResponse(`Parent category not found with id of ${newParentId}`, 404));
      }
      
      // Check if the current category is an ancestor of the new parent
      let current = parentCategory;
      while(current) {
        if (current._id.toString() === categoryId) {
            return next(new ErrorResponse('Circular reference detected: a category cannot be a descendant of itself.', 400));
        }
        if (!current.parent) break;
        current = await Category.findById(current.parent); // This loop is acceptable as hierarchies are rarely deep
      }
    }

    // Update category
    category = await Category.findByIdAndUpdate(categoryId, req.body, {
      new: true,
      runValidators: true
    }).populate('parent', 'name slug');

    return success(res, 'Category updated successfully', { category });
  } catch (err) {
    // Handle specific MongoDB errors
    if (err.code === 11000) {
      return next(new ErrorResponse('Category name already exists', 400));
    }
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(val => val.message);
      return next(new ErrorResponse(messages.join(', '), 400));
    }
    next(err);
  }
};

/**
 * @desc      Delete category
 * @route     DELETE /api/v1/admin/categories/:id
 * @access    Private/Admin
 */
exports.deleteCategory = async (req, res, next) => {
  try {
    const categoryId = req.params.id;
    const category = await Category.findById(categoryId);

    if (!category) {
      return next(new ErrorResponse(`Category not found with id of ${categoryId}`, 404));
    }

    // Check if category has any associations before deleting
    const productCount = await Product.countDocuments({ category: categoryId });
    if (productCount > 0) {
      return next(new ErrorResponse(`Cannot delete. This category has ${productCount} associated products.`, 400));
    }

    const subcategoriesCount = await Category.countDocuments({ parent: categoryId });
    if (subcategoriesCount > 0) {
      return next(new ErrorResponse(`Cannot delete. This category has ${subcategoriesCount} subcategories.`, 400));
    }

    await category.deleteOne();

    return success(res, 'Category deleted successfully', { });
  } catch (err) {
    next(err);
  }
};