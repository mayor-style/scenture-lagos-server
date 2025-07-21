const Order = require('../../models/order.model');
const Product = require('../../models/product.model');
const User = require('../../models/user.model');
const { success, error } = require('../../utils/response.util');
const mongoose = require('mongoose');

/**
 * @desc    Get dashboard summary metrics, charts, and recent activity
 * @route   GET /api/v1/admin/dashboard/summary
 * @access  Private/Admin
 * @note    This is a highly optimized endpoint using a single database call with $facet
 * to gather multiple independent metrics efficiently.
 */
exports.getDashboardSummary = async (req, res, next) => {
  try {
    // --- 1. Date Range Calculation ---
    // A helper function would be even cleaner, but this is fine.
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(new Date().setDate(endDate.getDate() - 30));
    
    // Set time to end of the day for accurate inclusion
    endDate.setHours(23, 59, 59, 999);

    const timeDiff = endDate.getTime() - startDate.getTime();
    const prevStartDate = new Date(startDate.getTime() - timeDiff);
    const prevEndDate = new Date(startDate.getTime());

    // --- 2. Main Aggregation with $facet ---
    const [summaryData] = await Order.aggregate([
      {
        $facet: {
          // Pipeline for Current Period Sales & Orders
          currentPeriod: [
            {
              $match: {
                createdAt: { $gte: startDate, $lte: endDate },
                'paymentInfo.status': 'paid'
              }
            },
            {
              $group: {
                _id: null,
                totalSales: { $sum: '$totalAmount' },
                totalOrders: { $sum: 1 }
              }
            }
          ],
          // Pipeline for Previous Period Sales & Orders
          previousPeriod: [
            {
              $match: {
                createdAt: { $gte: prevStartDate, $lte: prevEndDate },
                'paymentInfo.status': 'paid'
              }
            },
            {
              $group: {
                _id: null,
                totalSales: { $sum: '$totalAmount' },
                totalOrders: { $sum: 1 }
              }
            }
          ],
          // Pipeline for Sales by Day Chart
          salesByDay: [
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
                orders: { $sum: 1 }
              }
            },
            { $sort: { _id: 1 } }
          ],
          // Pipeline for Order Status Distribution
          orderStatusDistribution: [
            { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
            { $group: { _id: '$status', count: { $sum: 1 } } }
          ]
        }
      }
    ]);

    // --- 3. Fetching metrics not related to Orders ---
    // These are separate but still necessary.
    const [
      newCustomers,
      prevNewCustomers,
      inventoryValue,
      lowStockProducts
    ] = await Promise.all([
      User.countDocuments({ role: 'customer', createdAt: { $gte: startDate, $lte: endDate } }),
      User.countDocuments({ role: 'customer', createdAt: { $gte: prevStartDate, $lte: prevEndDate } }),
      Product.getTotalInventoryValue(),
      Product.countDocuments({ stockQuantity: { $lte: 5, $gt: 0 } })
    ]);

    // --- 4. Process and Format the results ---
    const currentSales = summaryData.currentPeriod[0]?.totalSales || 0;
    const prevSales = summaryData.previousPeriod[0]?.totalSales || 0;
    const currentOrders = summaryData.currentPeriod[0]?.totalOrders || 0;
    const prevOrders = summaryData.previousPeriod[0]?.totalOrders || 0;

    const calculateGrowth = (current, previous) => {
      if (previous === 0) return current > 0 ? 100 : 0; // Handle division by zero
      return parseFloat(((current - previous) / previous * 100).toFixed(1));
    };

    // Fill in missing dates for the sales chart (your logic was perfect)
    const salesChart = [];
    const loopDate = new Date(startDate);
    while (loopDate <= endDate) {
      const dateStr = loopDate.toISOString().split('T')[0];
      const dayData = summaryData.salesByDay.find(d => d._id === dateStr) || { sales: 0, orders: 0 };
      salesChart.push({ date: dateStr, sales: dayData.sales, orders: dayData.orders });
      loopDate.setDate(loopDate.getDate() + 1);
    }
    
    // --- 5. Construct Final Response ---
    return success(res, 'Dashboard summary retrieved successfully', {
      metrics: {
        totalSales: currentSales,
        totalOrders: currentOrders,
        newCustomers: newCustomers || 0,
        inventoryValue: inventoryValue || 0,
        lowStockProducts: lowStockProducts || 0,
        salesGrowth: calculateGrowth(currentSales, prevSales),
        ordersGrowth: calculateGrowth(currentOrders, prevOrders),
        customersGrowth: calculateGrowth(newCustomers, prevNewCustomers)
      },
      charts: {
        salesChart: salesChart,
        orderStatusChart: summaryData.orderStatusDistribution || []
      },
      dateRange: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
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
      .populate({ path: 'user', select: 'firstName lastName email' })
      .lean(); // .lean() is great for performance!

    return success(res, 'Recent orders retrieved successfully', { orders });
  } catch (err) {
    next(err);
  }
};


/**
 * @desc    Get a unified activity feed
 * @route   GET /api/v1/admin/dashboard/activity-feed
 * @access  Private/Admin
 * @note    This is a highly optimized endpoint that uses $unionWith to combine
 * multiple collections into a single sorted feed on the database side.
 */
exports.getActivityFeed = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 10;

    // Base pipeline for new customer registrations
    const activities = await User.aggregate([
      { $match: { role: 'customer' } },
      { $sort: { createdAt: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          id: '$_id',
          type: 'customer',
          message: { $concat: ['New customer registered: ', '$firstName', ' ', '$lastName'] },
          timestamp: '$createdAt',
          user: { $concat: ['$firstName', ' ', '$lastName'] }
        }
      },
      // Union with new orders
      {
        $unionWith: {
          coll: 'orders',
          pipeline: [
            { $sort: { createdAt: -1 } },
            { $limit: limit },
            {
              $project: {
                _id: 0, id: '$_id', type: 'order',
                message: { $concat: ['Order #', '$orderNumber', ' was placed'] },
                timestamp: '$createdAt'
              }
            }
          ]
        }
      },
      // Union with low stock products
      {
        $unionWith: {
          coll: 'products',
          pipeline: [
            { $match: { stockQuantity: { $lte: 5, $gt: 0 } } },
            { $sort: { updatedAt: -1 } },
            { $limit: limit },
            {
              $project: {
                _id: 0, id: '$_id', type: 'inventory',
                message: { $concat: ['Low inventory for product: ', '$name'] },
                timestamp: '$updatedAt'
              }
            }
          ]
        }
      },
      // Final sort and limit of the combined results
      { $sort: { timestamp: -1 } },
      { $limit: limit }
    ]);

    return success(res, 'Activity feed retrieved successfully', { activities });
  } catch (err) {
    next(err);
  }
};

// This endpoint is now redundant as its logic is inside getDashboardSummary
// If you need it for a separate chart component that can change periods,
// we can extract the chart logic into a helper function.
// For now, I'm removing it to keep the API clean.

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