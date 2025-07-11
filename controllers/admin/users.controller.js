const User = require('../../models/user.model');
const { ErrorResponse } = require('../../middleware/error.middleware');
const { success, error, paginate } = require('../../utils/response.util');
const { validatePassword } = require('../../utils/validator.util');

/**
 * @desc    Get all admin users
 * @route   GET /api/v1/admin/users
 * @access  Private/SuperAdmin
 */
exports.getUsers = async (req, res, next) => {
  try {
    // Pagination
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;

    // Filter for admin users only
    const filter = { role: { $in: ['admin', 'superadmin'] } };

    // Search by name or email
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      filter.$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex }
      ];
    }

    // Execute query with pagination
    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(startIndex)
      .limit(limit);

    return paginate(
      res,
      'Admin users retrieved successfully',
      users,
      page,
      limit,
      total
    );
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get single admin user
 * @route   GET /api/v1/admin/users/:id
 * @access  Private/SuperAdmin
 */
exports.getUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select('-password');

    if (!user) {
      return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
    }

    // Check if user is admin or superadmin
    if (!['admin', 'superadmin'].includes(user.role)) {
      return next(new ErrorResponse(`User with id ${req.params.id} is not an admin user`, 400));
    }

    return success(res, 'Admin user retrieved successfully', { user });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Create admin user
 * @route   POST /api/v1/admin/users
 * @access  Private/SuperAdmin
 */
exports.createUser = async (req, res, next) => {
  try {
    const { firstName, lastName, email, password, role, phone } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email || !password) {
      return next(new ErrorResponse('Please provide all required fields', 400));
    }

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return next(new ErrorResponse(passwordValidation.message, 400));
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return next(new ErrorResponse('Email already in use', 400));
    }

    // Ensure role is admin or superadmin
    if (role && !['admin', 'superadmin'].includes(role)) {
      return next(new ErrorResponse('Invalid role. Must be admin or superadmin', 400));
    }

    // Create user
    const user = await User.create({
      firstName,
      lastName,
      email,
      password,
      role: role || 'admin',
      phone,
      createdBy: req.user.id
    });

    // Remove password from response
    user.password = undefined;

    return success(res, 'Admin user created successfully', { user }, 201);
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Update admin user
 * @route   PUT /api/v1/admin/users/:id
 * @access  Private/SuperAdmin
 */
exports.updateUser = async (req, res, next) => {
  try {
    // Find user
    let user = await User.findById(req.params.id);

    if (!user) {
      return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
    }

    // Check if user is admin or superadmin
    if (!['admin', 'superadmin'].includes(user.role)) {
      return next(new ErrorResponse(`User with id ${req.params.id} is not an admin user`, 400));
    }

    // Prevent superadmin from being downgraded by non-superadmin
    if (user.role === 'superadmin' && req.user.role !== 'superadmin') {
      return next(new ErrorResponse('Not authorized to modify a superadmin user', 403));
    }

    // Fields to update
    const fieldsToUpdate = {};
    
    // Only update fields that were actually passed
    const updateableFields = ['firstName', 'lastName', 'email', 'phone', 'role', 'active'];
    updateableFields.forEach(field => {
      if (req.body[field] !== undefined) {
        fieldsToUpdate[field] = req.body[field];
      }
    });

    // Validate role if being updated
    if (fieldsToUpdate.role && !['admin', 'superadmin'].includes(fieldsToUpdate.role)) {
      return next(new ErrorResponse('Invalid role. Must be admin or superadmin', 400));
    }

    // Update user
    user = await User.findByIdAndUpdate(
      req.params.id,
      fieldsToUpdate,
      { new: true, runValidators: true }
    ).select('-password');

    return success(res, 'Admin user updated successfully', { user });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Delete admin user
 * @route   DELETE /api/v1/admin/users/:id
 * @access  Private/SuperAdmin
 */
exports.deleteUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
    }

    // Check if user is admin or superadmin
    if (!['admin', 'superadmin'].includes(user.role)) {
      return next(new ErrorResponse(`User with id ${req.params.id} is not an admin user`, 400));
    }

    // Prevent superadmin from being deleted by non-superadmin
    if (user.role === 'superadmin' && req.user.role !== 'superadmin') {
      return next(new ErrorResponse('Not authorized to delete a superadmin user', 403));
    }

    // Prevent user from deleting themselves
    if (user._id.toString() === req.user.id) {
      return next(new ErrorResponse('You cannot delete your own account', 400));
    }

    await user.deleteOne();

    return success(res, 'Admin user deleted successfully');
  } catch (err) {
    next(err);
  }
};