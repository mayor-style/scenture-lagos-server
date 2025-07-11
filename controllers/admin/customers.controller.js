const User = require('../../models/user.model');
const Order = require('../../models/order.model');
const Review = require('../../models/review.model');
const { ErrorResponse } = require('../../middleware/error.middleware');
const { success, error, paginate } = require('../../utils/response.util');

/**
 * @desc    Get all customers
 * @route   GET /api/v1/admin/customers
 * @access  Private/Admin
 */
exports.getCustomers = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;

    const filter = { role: 'customer' };

    // Filter by status (mapped from active boolean)
    if (req.query.status && ['active', 'inactive'].includes(req.query.status)) {
      filter.active = req.query.status === 'active';
    }

    // Filter by date range
    if (req.query.startDate && req.query.endDate) {
      const startDate = new Date(req.query.startDate);
      const endDate = new Date(req.query.endDate);
      if (startDate && endDate) {
        filter.createdAt = {
          $gte: startDate,
          $lte: new Date(endDate.setHours(23, 59, 59, 999)),
        };
      }
    }

    // Search by name, email, or phone
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      filter.$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
      ];
    }

    const total = await User.countDocuments(filter);
    const customers = await User.find(filter)
      .select('-password')
      .sort(req.query.sort || '-createdAt')
      .skip(startIndex)
      .limit(limit);

    const customerIds = customers.map((customer) => customer._id);
    const orderAggregates = await Order.aggregate([
      { $match: { user: { $in: customerIds } } },
      {
        $group: {
          _id: '$user',
          count: { $sum: 1 },
          totalSpent: { $sum: '$totalAmount' },
          lastOrderDate: { $max: '$createdAt' },
        },
      },
    ]);

    const orderInfoMap = {};
    orderAggregates.forEach((item) => {
      orderInfoMap[item._id] = {
        total_orders: item.count,
        total_spent: item.totalSpent,
        last_order_date: item.lastOrderDate,
      };
    });

    const customersWithOrderInfo = customers.map((customer) => {
      const customerObj = customer.toObject();
      customerObj.name = customer.fullName;
      customerObj.status = customer.active ? 'active' : 'inactive';
      customerObj.total_orders = orderInfoMap[customer._id]?.total_orders || 0;
      customerObj.total_spent = orderInfoMap[customer._id]?.total_spent || 0;
      customerObj.last_order_date = orderInfoMap[customer._id]?.last_order_date
        ? new Date(orderInfoMap[customer._id].last_order_date).toISOString().split('T')[0]
        : null;
      customerObj.id = customer._id;
      return customerObj;
    });

    return paginate(
      res,
      'Customers retrieved successfully',
      customersWithOrderInfo,
      page,
      limit,
      total
    );
  } catch (err) {
    next(new ErrorResponse('Failed to retrieve customers', 500));
  }
};

/**
 * @desc    Create a new customer
 * @route   POST /api/v1/admin/customers
 * @access  Private/Admin
 */
exports.createCustomer = async (req, res, next) => {
  try {
    const { firstName, lastName, email, phone, password, address } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return next(new ErrorResponse('Please provide firstName, lastName, email, and password', 400));
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return next(new ErrorResponse('Email already exists', 400));
    }

    const customerData = {
      firstName,
      lastName,
      email,
      phone,
      password,
      address,
      role: 'customer',
      active: true,
    };

    const customer = await User.create(customerData);

    return success(res, 'Customer created successfully', { customer: customer.toObject({ virtuals: true }) }, 201);
  } catch (err) {
    next(new ErrorResponse('Failed to create customer', 500));
  }
};

/**
 * @desc    Get single customer
 * @route   GET /api/v1/admin/customers/:id
 * @access  Private/Admin
 */
exports.getCustomer = async (req, res, next) => {
  console.log('get customer hit!!')
  try {
    const customer = await User.findById(req.params.id)
      .select('-password')
      .populate({
        path: 'notes.createdBy',
        select: 'firstName lastName',
      });

    if (!customer) {
      return next(new ErrorResponse(`Customer not found with id of ${req.params.id}`, 404));
    }

    if (customer.role !== 'customer') {
      return next(new ErrorResponse(`User with id ${req.params.id} is not a customer`, 400));
    }

    const orders = await Order.find({ user: req.params.id })
      .sort('-createdAt')
      .limit(5);

    const totalSpentResult = await Order.aggregate([
      {
        $match: {
          user: customer._id,
          'paymentInfo.status': 'paid',
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$totalAmount' },
        },
      },
    ]);

    const totalSpent = totalSpentResult.length > 0 ? totalSpentResult[0].total : 0;
    const orderCount = await Order.countDocuments({ user: req.params.id });

    const formattedCustomer = customer.toObject();
    formattedCustomer.id = customer._id;
    formattedCustomer.name = customer.fullName;
    formattedCustomer.created_at = customer.createdAt.toISOString().split('T')[0];
    formattedCustomer.status = customer.active ? 'active' : 'inactive';
    formattedCustomer.total_orders = orderCount;
    formattedCustomer.total_spent = totalSpent;
    formattedCustomer.address = {
      ...customer.address,
      postal_code: customer.address?.postalCode,
    };
    formattedCustomer.notes = customer.notes.map((note) => ({
      ...note,
      id: note._id,
      author: note.createdBy ? `${note.createdBy.firstName} ${note.createdBy.lastName}` : 'Admin',
      date: note.createdAt.toISOString().split('T')[0],
    }));

    const formattedOrders = orders.map((order) => ({
      id: order._id,
      date: order.createdAt.toISOString().split('T')[0],
      status: order.status,
      total: order.totalAmount,
      items: order.items.length,
    }));

    return success(res, 'Customer retrieved successfully', {
      customer: formattedCustomer,
      recentOrders: formattedOrders,
      stats: { totalSpent, orderCount },
    });
  } catch (err) {
    next(new ErrorResponse('Failed to retrieve customer', 500));
  }
};

/**
 * @desc    Update customer
 * @route   PUT /api/v1/admin/customers/:id
 * @access  Private/Admin
 */
exports.updateCustomer = async (req, res, next) => {
  try {
    let customer = await User.findById(req.params.id);

    if (!customer) {
      return next(new ErrorResponse(`Customer not found with id of ${req.params.id}`, 404));
    }

    if (customer.role !== 'customer') {
      return next(new ErrorResponse(`User with id ${req.params.id} is not a customer`, 400));
    }

    const fieldsToUpdate = {};
    const updateableFields = ['firstName', 'lastName', 'email', 'phone', 'address', 'active'];
    updateableFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        fieldsToUpdate[field] = req.body[field];
      }
    });

    // Handle password update
    if (req.body.password) {
      if (req.body.password.length < 6) {
        return next(new ErrorResponse('Password must be at least 6 characters', 400));
      }
      const salt = await bcrypt.genSalt(10);
      fieldsToUpdate.password = await bcrypt.hash(req.body.password, salt);
    }

    // Validate email uniqueness if email is being updated
    if (req.body.email && req.body.email !== customer.email) {
      const existingUser = await User.findOne({ email: req.body.email });
      if (existingUser) {
        return next(new ErrorResponse('Email already exists', 400));
      }
    }

    fieldsToUpdate.role = 'customer';

    customer = await User.findByIdAndUpdate(req.params.id, fieldsToUpdate, {
      new: true,
      runValidators: true,
    }).select('-password');

    const formattedCustomer = customer.toObject();
    formattedCustomer.id = customer._id;
    formattedCustomer.name = customer.fullName;
    formattedCustomer.created_at = customer.createdAt.toISOString().split('T')[0];
    formattedCustomer.status = customer.active ? 'active' : 'inactive';
    formattedCustomer.address = {
      ...customer.address,
      postal_code: customer.address?.postalCode,
    };

    return success(res, 'Customer updated successfully', { customer: formattedCustomer });
  } catch (err) {
    next(new ErrorResponse('Failed to update customer', 500));
  }
};

/**
 * @desc    Get customer orders
 * @route   GET /api/v1/admin/customers/:id/orders
 * @access  Private/Admin
 */
exports.getCustomerOrders = async (req, res, next) => {
  try {
    const customer = await User.findById(req.params.id);

    if (!customer) {
      return next(new ErrorResponse(`Customer not found with id of ${req.params.id}`, 404));
    }

    if (customer.role !== 'customer') {
      return next(new ErrorResponse(`User with id ${req.params.id} is not a customer`, 400));
    }

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;

    const filter = { user: req.params.id };

    if (req.query.status && ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'].includes(req.query.status)) {
      filter.status = req.query.status;
    }

    const total = await Order.countDocuments(filter);
    const orders = await Order.find(filter)
      .sort('-createdAt')
      .skip(startIndex)
      .limit(limit);

      const customerOrders = Array.isArray(orders) ? orders : [];
    const formattedOrders = customerOrders.map((order) => ({
      id: order._id,
      date: order.createdAt.toISOString().split('T')[0],
      status: order.status,
      total: order.totalAmount,
      items: order.items.length,
    }));

    return paginate(res, 'Customer orders retrieved successfully', formattedOrders, page, limit, total);
  } catch (err) {
    next(new ErrorResponse('Failed to retrieve customer orders', 500));
  }
};

/**
 * @desc    Add customer note
 * @route   POST /api/v1/admin/customers/:id/notes
 * @access  Private/Admin
 */
exports.addCustomerNote = async (req, res, next) => {
  try {
    const { content } = req.body;

    if (!content) {
      return next(new ErrorResponse('Please provide note content', 400));
    }

    let customer = await User.findById(req.params.id);

    if (!customer) {
      return next(new ErrorResponse(`Customer not found with id of ${req.params.id}`, 404));
    }

    if (customer.role !== 'customer') {
      return next(new ErrorResponse(`User with id ${req.params.id} is not a customer`, 400));
    }

    if (!customer.notes) {
      customer.notes = [];
    }

    customer.notes.push({
      content,
      createdBy: req.user.id,
      createdAt: Date.now(),
    });

    await customer.save({ validateBeforeSave: false });

    customer = await User.findById(req.params.id)
      .select('-password')
      .populate({
        path: 'notes.createdBy',
        select: 'firstName lastName',
      });

    const formattedCustomer = customer.toObject();
    formattedCustomer.id = customer._id;
    formattedCustomer.name = customer.fullName;
    formattedCustomer.created_at = customer.createdAt.toISOString().split('T')[0];
    formattedCustomer.status = customer.active ? 'active' : 'inactive';
    formattedCustomer.notes = customer.notes.map((note) => ({
      ...note,
      id: note._id,
      author: note.createdBy ? `${note.createdBy.firstName} ${note.createdBy.lastName}` : 'Admin',
      date: note.createdAt.toISOString().split('T')[0],
    }));

    return success(res, 'Customer note added successfully', { customer: formattedCustomer });
  } catch (err) {
    next(new ErrorResponse('Failed to add customer note', 500));
  }
};

/**
 * @desc    Get customer notes
 * @route   GET /api/v1/admin/customers/:id/notes
 * @access  Private/Admin
 */
exports.getCustomerNotes = async (req, res, next) => {
  try {
    const customer = await User.findById(req.params.id)
      .select('notes role firstName lastName')
      .populate({
        path: 'notes.createdBy',
        select: 'firstName lastName',
      });

    if (!customer) {
      return next(new ErrorResponse(`Customer not found with id of ${req.params.id}`, 404));
    }

    if (customer.role !== 'customer') {
      return next(new ErrorResponse(`User with id ${req.params.id} is not a customer`, 400));
    }

    // Ensure notes is an array, default to empty array if undefined or null
    const notes = Array.isArray(customer.notes) ? customer.notes : [];
    const formattedNotes = notes.map((note) => ({
      id: note._id,
      content: note.content,
      author: note.createdBy ? `${note.createdBy.firstName} ${note.createdBy.lastName}` : 'Admin',
      date: note.createdAt.toISOString().split('T')[0],
    }));

    return success(res, 'Customer notes retrieved successfully', { notes: formattedNotes });
  } catch (err) {
    next(new ErrorResponse('Failed to retrieve customer notes', 500));
  }
};

/**
 * @desc    Delete customer note
 * @route   DELETE /api/v1/admin/customers/:id/notes/:noteId
 * @access  Private/Admin
 */
exports.deleteCustomerNote = async (req, res, next) => {
  try {
    const customer = await User.findById(req.params.id);

    if (!customer) {
      return next(new ErrorResponse(`Customer not found with id of ${req.params.id}`, 404));
    }

    if (customer.role !== 'customer') {
      return next(new ErrorResponse(`User with id ${req.params.id} is not a customer`, 400));
    }

    const noteIndex = customer.notes.findIndex((note) => note._id.toString() === req.params.noteId);

    if (noteIndex === -1) {
      return next(new ErrorResponse(`Note not found with id of ${req.params.noteId}`, 404));
    }

    customer.notes.splice(noteIndex, 1);
    await customer.save({ validateBeforeSave: false });

    return success(res, 'Customer note deleted successfully', {});
  } catch (err) {
    next(new ErrorResponse('Failed to delete customer note', 500));
  }
};

/**
 * @desc    Get customer reviews
 * @route   GET /api/v1/admin/customers/:id/reviews
 * @access  Private/Admin
 */
exports.getCustomerReviews = async (req, res, next) => {
  try {
    const customer = await User.findById(req.params.id);

    if (!customer) {
      return next(new ErrorResponse(`Customer not found with id of ${req.params.id}`, 404));
    }

    if (customer.role !== 'customer') {
      return next(new ErrorResponse(`User with id ${req.params.id} is not a customer`, 400));
    }

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;

    const filter = { user: req.params.id, status: 'approved' };

    const total = await Review.countDocuments(filter);
    const reviews = await Review.find(filter)
      .populate({
        path: 'product',
        select: 'name',
      })
      .sort('-createdAt')
      .skip(startIndex)
      .limit(limit);

      const customerReviews =  Array.isArray(reviews) ? reviews : [];
    const formattedReviews = customerReviews.map((review) => ({
      id: review._id,
      product_name: review.product?.name || 'Unknown Product',
      product_id: review.product?._id || null,
      rating: review.rating,
      date: review.createdAt.toISOString().split('T')[0],
      content: review.comment,
    }));

    return paginate(res, 'Customer reviews retrieved successfully', formattedReviews, page, limit, total);
  } catch (err) {
    next(new ErrorResponse('Failed to retrieve customer reviews', 500));
  }
};

/**
 * @desc    Update customer VIP status
 * @route   PUT /api/v1/admin/customers/:id/vip
 * @access  Private/Admin
 */
exports.updateCustomerVip = async (req, res, next) => {
  try {
    let customer = await User.findById(req.params.id);

    if (!customer) {
      return next(new ErrorResponse(`Customer not found with id of ${req.params.id}`, 404));
    }

    if (customer.role !== 'customer') {
      return next(new ErrorResponse(`User with id ${req.params.id} is not a customer`, 400));
    }

    customer.isVip = req.body.isVip !== undefined ? req.body.isVip : true;
    await customer.save();

    const formattedCustomer = customer.toObject();
    formattedCustomer.id = customer._id;
    formattedCustomer.name = customer.fullName;
    formattedCustomer.status = customer.active ? 'active' : 'inactive';

    return success(res, 'Customer VIP status updated successfully', { customer: formattedCustomer });
  } catch (err) {
    next(new ErrorResponse('Failed to update customer VIP status', 500));
  }
};

/**
 * @desc    Flag customer for review
 * @route   PUT /api/v1/admin/customers/:id/flag
 * @access  Private/Admin
 */
exports.updateCustomerFlag = async (req, res, next) => {
  try {
    let customer = await User.findById(req.params.id);

    if (!customer) {
      return next(new ErrorResponse(`Customer not found with id of ${req.params.id}`, 404));
    }

    if (customer.role !== 'customer') {
      return next(new ErrorResponse(`User with id ${req.params.id} is not a customer`, 400));
    }

    customer.isFlagged = req.body.isFlagged !== undefined ? req.body.isFlagged : true;
    await customer.save();

    const formattedCustomer = customer.toObject();
    formattedCustomer.id = customer._id;
    formattedCustomer.name = customer.fullName;
    formattedCustomer.status = customer.active ? 'active' : 'inactive';

    return success(res, 'Customer flag status updated successfully', { customer: formattedCustomer });
  } catch (err) {
    next(new ErrorResponse('Failed to update customer flag status', 500));
  }
};

/**
 * @desc    Deactivate customer
 * @route   PUT /api/v1/admin/customers/:id/deactivate
 * @access  Private/Admin
 */
exports.deactivateCustomer = async (req, res, next) => {
  try {
    let customer = await User.findById(req.params.id);

    if (!customer) {
      return next(new ErrorResponse(`Customer not found with id of ${req.params.id}`, 404));
    }

    if (customer.role !== 'customer') {
      return next(new ErrorResponse(`User with id ${req.params.id} is not a customer`, 400));
    }

    customer.active = false;
    await customer.save();

    const formattedCustomer = customer.toObject();
    formattedCustomer.id = customer._id;
    formattedCustomer.name = customer.fullName;
    formattedCustomer.status = 'inactive';

    return success(res, 'Customer deactivated successfully', { customer: formattedCustomer });
  } catch (err) {
    next(new ErrorResponse('Failed to deactivate customer', 500));
  }
};