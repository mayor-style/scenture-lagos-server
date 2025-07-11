const Order = require('../../models/order.model');
const Product = require('../../models/product.model');
const User = require('../../models/user.model');
const { success, error } = require('../../utils/response.util');


/**
 * @desc    Get dashboard summary metrics
 * @route   GET /api/v1/admin/dashboard/summary
 * @access  Private/Admin
 */
exports.getDashboardSummary = async (req, res, next) => {
  try {
  const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    const prevStartDate = new Date(startDate);
    prevStartDate.setDate(prevStartDate.getDate() - 30);
    const prevEndDate = new Date(startDate);

    if (req.query.startDate && req.query.endDate) {
      const queryStartDate = new Date(req.query.startDate);
      const queryEndDate = new Date(req.query.endDate);
      if (queryStartDate && queryEndDate && !isNaN(queryStartDate.getTime()) && !isNaN(queryEndDate.getTime())) {
        startDate.setTime(queryStartDate.getTime());
        endDate.setTime(queryEndDate.getTime());
        prevStartDate.setTime(queryStartDate.getTime() - (endDate - startDate));
        prevEndDate.setTime(queryStartDate.getTime());
      }
    }

    endDate.setHours(23, 59, 59, 999);

    const [totalSales, prevTotalSales] = await Promise.all([
      Order.getTotalSales(startDate, endDate),
      Order.getTotalSales(prevStartDate, prevEndDate)
    ]);

    const [totalOrders, prevTotalOrders] = await Promise.all([
      Order.countDocuments({
        createdAt: { $gte: startDate, $lte: endDate },
        'paymentInfo.status': 'paid'
      }),
      Order.countDocuments({
        createdAt: { $gte: prevStartDate, $lte: prevEndDate },
        'paymentInfo.status': 'paid'
      })
    ]);

    const [newCustomers, prevNewCustomers] = await Promise.all([
      User.countDocuments({
        role: 'customer',
        createdAt: { $gte: startDate, $lte: endDate }
      }),
      User.countDocuments({
        role: 'customer',
        createdAt: { $gte: prevStartDate, $lte: prevEndDate }
      })
    ]);

    const salesGrowth = prevTotalSales > 0 ? ((totalSales - prevTotalSales) / prevTotalSales * 100).toFixed(1) : 0;
    const ordersGrowth = prevTotalOrders > 0 ? ((totalOrders - prevTotalOrders) / prevTotalOrders * 100).toFixed(1) : 0;
    const customersGrowth = prevNewCustomers > 0 ? ((newCustomers - prevNewCustomers) / prevNewCustomers * 100).toFixed(1) : 0;

    const inventoryValue = await Product.getTotalInventoryValue();

    const lowStockThreshold = 5;
    const lowStockProducts = await Product.countDocuments({
      stockQuantity: { $lte: lowStockThreshold, $gt: 0 }
    });

    const salesByDay = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          'paymentInfo.status': 'paid'
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          sales: { $sum: '$totalAmount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const salesChart = [];
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const dayData = salesByDay.find(day => day._id === dateStr) || { sales: 0, count: 0 };
      salesChart.push({
        date: dateStr,
        sales: dayData.sales,
        orders: dayData.count
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const orderStatusDistribution = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const orderStatusChart = orderStatusDistribution.map(status => ({
      status: status._id,
      count: status.count
    }));

    return success(res, 'Dashboard summary retrieved successfully', {
      metrics: {
        totalSales: totalSales || 0,
        totalOrders: totalOrders || 0,
        newCustomers: newCustomers || 0,
        inventoryValue: inventoryValue || 0,
        lowStockProducts: lowStockProducts || 0,
        salesGrowth: parseFloat(salesGrowth) || 0,
        ordersGrowth: parseFloat(ordersGrowth) || 0,
        customersGrowth: parseFloat(customersGrowth) || 0
      },
      charts: {
        salesChart: salesChart || [],
        orderStatusChart: orderStatusChart || []
      },
      dateRange: {
        startDate,
        endDate
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get recent orders
 * @route   GET /api/v1/admin/dashboard/recent-orders
 * @access  Private/Admin
 */
exports.getRecentOrders = async (req, res, next) => {
  try {

    const limit = parseInt(req.query.limit, 10) || 5;
    const orders = await Order.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate({
        path: 'user',
        select: 'firstName lastName email'
      })
      .lean();

    const formattedOrders = orders.map(order => ({
      ...order,
      orderNumber: order.orderNumber || `SCL-${order._id.toString().slice(-4)}`
    }));

    return success(res, 'Recent orders retrieved successfully', { orders: formattedOrders || [] });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get activity feed
 * @route   GET /api/v1/admin/dashboard/activity-feed
 * @access  Private/Admin
 */
exports.getActivityFeed = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 10;
    const type = req.query.type || 'all';

    let activities = [];

    if (type === 'all') {
      // Aggregate activities from all collections
      const orderActivities = await Order.aggregate([
        { $sort: { createdAt: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: 'users',
            localField: 'user',
            foreignField: '_id',
            as: 'user',
          },
        },
        {
          $unwind: {
            path: '$user',
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            type: 'order',
            id: '$_id',
            orderNumber: 1,
            user: {
              $concat: [
                { $ifNull: ['$user.firstName', ''] },
                ' ',
                { $ifNull: ['$user.lastName', ''] },
              ],
            },
            status: 1,
            timestamp: '$createdAt',
            message: {
              $concat: ['Order #', '$orderNumber', ' status changed to ', '$status'],
            },
          },
        },
      ]);

      const customerActivities = await User.aggregate([
        { $match: { role: 'customer' } },
        { $sort: { createdAt: -1 } },
        { $limit: limit },
        {
          $project: {
            type: 'customer',
            id: '$_id',
            user: {
              $concat: [
                { $ifNull: ['$firstName', ''] },
                ' ',
                { $ifNull: ['$lastName', ''] },
              ],
            },
            email: 1,
            timestamp: '$createdAt',
            message: {
              $concat: ['New customer registered: ', '$firstName', ' ', '$lastName'],
            },
          },
        },
      ]);

      const productActivities = await Product.aggregate([
        { $sort: { createdAt: -1 } },
        { $limit: limit },
        {
          $project: {
            type: 'product',
            id: '$_id',
            name: 1,
            timestamp: '$createdAt',
            message: {
              $concat: ['New product added: ', '$name'],
            },
          },
        },
      ]);

      const inventoryActivities = await Product.aggregate([
        {
          $match: {
            stockQuantity: { $lte: 5, $gt: 0 },
          },
        },
        { $sort: { updatedAt: -1 } },
        { $limit: limit },
        {
          $project: {
            type: 'inventory',
            id: '$_id',
            name: 1,
            timestamp: '$updatedAt',
            message: {
              $concat: ['Low inventory for ', '$name'],
            },
          },
        },
      ]);

      // Combine and sort activities
      activities = [
        ...orderActivities,
        ...customerActivities,
        ...productActivities,
        ...inventoryActivities,
      ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit);
    } else {
      // Handle specific type queries
      switch (type) {
        case 'order':
          activities = await Order.aggregate([
            { $sort: { createdAt: -1 } },
            { $limit: limit },
            {
              $lookup: {
                from: 'users',
                localField: 'user',
                foreignField: '_id',
                as: 'user',
              },
            },
            {
              $unwind: {
                path: '$user',
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $project: {
                type: 'order',
                id: '$_id',
                orderNumber: 1,
                user: {
                  $concat: [
                    { $ifNull: ['$user.firstName', ''] },
                    ' ',
                    { $ifNull: ['$user.lastName', ''] },
                  ],
                },
                status: 1,
                timestamp: '$createdAt',
                message: {
                  $concat: ['Order #', '$orderNumber', ' status changed to ', '$status'],
                },
              },
            },
          ]);
          break;

        case 'customer':
          activities = await User.aggregate([
            { $match: { role: 'customer' } },
            { $sort: { createdAt: -1 } },
            { $limit: limit },
            {
              $project: {
                type: 'customer',
                id: '$_id',
                user: {
                  $concat: [
                    { $ifNull: ['$firstName', ''] },
                    ' ',
                    { $ifNull: ['$lastName', ''] },
                  ],
                },
                email: 1,
                timestamp: '$createdAt',
                message: {
                  $concat: ['New customer registered: ', '$firstName', ' ', '$lastName'],
                },
              },
            },
          ]);
          break;

        case 'product':
          activities = await Product.aggregate([
            { $sort: { createdAt: -1 } },
            { $limit: limit },
            {
              $project: {
                type: 'product',
                id: '$_id',
                name: 1,
                timestamp: '$createdAt',
                message: {
                  $concat: ['New product added: ', '$name'],
                },
              },
            },
          ]);
          break;

        case 'inventory':
          activities = await Product.aggregate([
            {
              $match: {
                stockQuantity: { $lte: 5, $gt: 0 },
              },
            },
            { $sort: { updatedAt: -1 } },
            { $limit: limit },
            {
              $project: {
                type: 'inventory',
                id: '$_id',
                name: 1,
                timestamp: '$updatedAt',
                message: {
                  $concat: ['Low inventory for ', '$name'],
                },
              },
            },
          ]);
          break;

        default:
          activities = [];
      }
    }

    return success(res, 'Activity feed retrieved successfully', { activities });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get sales data for charts
 * @route   GET /api/v1/admin/dashboard/sales-data
 * @access  Private/Admin
 */
exports.getSalesData = async (req, res, next) => {
  try {
    const { period = 'week', startDate, endDate } = req.query;
    let start = new Date();
    let end = new Date();
    end.setHours(23, 59, 59, 999);

    switch (period) {
      case 'week':
        start.setDate(start.getDate() - 7);
        break;
      case 'month':
        start.setMonth(start.getMonth() - 1);
        break;
      case 'year':
        start.setFullYear(start.getFullYear() - 1);
        break;
      default:
        start.setDate(start.getDate() - 7);
    }

    if (startDate && endDate) {
      const queryStartDate = new Date(startDate);
      const queryEndDate = new Date(endDate);
      if (queryStartDate && queryEndDate && !isNaN(queryStartDate.getTime()) && !isNaN(queryEndDate.getTime())) {
        start.setTime(queryStartDate.getTime());
        end.setTime(queryEndDate.getTime());
      }
    }

    const salesByDay = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lte: end },
          'paymentInfo.status': 'paid'
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          sales: { $sum: '$totalAmount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const salesChart = [];
    const currentDate = new Date(start);
    while (currentDate <= end) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const dayData = salesByDay.find(day => day._id === dateStr) || { sales: 0, count: 0 };
      salesChart.push({
        date: dateStr,
        sales: dayData.sales,
        orders: dayData.count
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return success(res, 'Sales data retrieved successfully', { salesChart });
  } catch (err) {
    next(err);
  }
};