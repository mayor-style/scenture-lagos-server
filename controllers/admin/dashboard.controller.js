const Order = require('../../models/order.model');
const Product = require('../../models/product.model');
const User = require('../../models/user.model');
const { success, error } = require('../../utils/response.util');

/**
 * @desc    Get dashboard summary metrics, charts, and recent activity
 * @route   GET /api/v1/admin/dashboard/summary
 * @access  Private/Admin
 * @note    This is a highly optimized endpoint using a single database call with $facet
 * to gather all independent metrics efficiently in one go.
 */
exports.getDashboardSummary = async (req, res, next) => {
  try {
    // --- 1. Date Range Calculation ---
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(new Date().setDate(endDate.getDate() - 30));

    endDate.setHours(23, 59, 59, 999);
    startDate.setHours(0, 0, 0, 0);

    const timeDiff = endDate.getTime() - startDate.getTime();
    const prevStartDate = new Date(startDate.getTime() - timeDiff);
    const prevEndDate = new Date(startDate.getTime() - 1);

    // --- 2. Main Aggregation with $facet ---
    const [summaryData] = await Order.aggregate([
      {
        $facet: {
          // ----- Order & Sales Metrics -----
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
          // ----- Chart Data -----
          salesByDay: [
            { $match: { createdAt: { $gte: startDate, $lte: endDate }, 'paymentInfo.status': 'paid' } },
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                sales: { $sum: '$totalAmount' },
                orders: { $sum: 1 }
              }
            },
            { $sort: { _id: 1 } }
          ],
          orderStatusDistribution: [
            { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
            { $group: { _id: '$status', count: { $sum: 1 } } }
          ],
          // ----- Customer Metrics (from Users collection) -----
          newCustomers: [
            { $match: { role: 'customer', createdAt: { $gte: startDate, $lte: endDate } } },
            { $count: 'count' }
          ],
          prevNewCustomers: [
            { $match: { role: 'customer', createdAt: { $gte: prevStartDate, $lte: prevEndDate } } },
            { $count: 'count' }
          ],
          // ----- Inventory Metrics (from Products collection) -----
          inventoryValue: [
            {
                $project: {
                    _id: 0,
                    productValue: {
                        $cond: {
                            // --- FIX: Use $ifNull to handle products without a 'variants' field ---
                            if: { $gt: [{ $size: { $ifNull: ['$variants', []] } }, 0] },
                            then: {
                                $sum: {
                                    $map: {
                                        input: '$variants',
                                        as: 'variant',
                                        in: { $multiply: [{ $add: ['$price', '$$variant.priceAdjustment'] }, '$$variant.stockQuantity'] },
                                    },
                                },
                            },
                            else: { $multiply: ['$price', '$stockQuantity'] },
                        },
                    },
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$productValue' },
                },
            },
          ],
          lowStockProducts: [
            { $match: { stockQuantity: { $lte: 5, $gt: 0 } } },
            { $count: 'count' }
          ]
        }
      }
    ]);
    
    // --- 3. Process and Format the results ---
    const currentSales = summaryData.currentPeriod[0]?.totalSales || 0;
    const prevSales = summaryData.previousPeriod[0]?.totalSales || 0;
    const currentOrders = summaryData.currentPeriod[0]?.totalOrders || 0;
    const prevOrders = summaryData.previousPeriod[0]?.totalOrders || 0;
    const newCustomers = summaryData.newCustomers[0]?.count || 0;
    const prevNewCustomers = summaryData.prevNewCustomers[0]?.count || 0;
    const inventoryValue = summaryData.inventoryValue[0]?.total || 0;
    const lowStockProducts = summaryData.lowStockProducts[0]?.count || 0;

    const calculateGrowth = (current, previous) => {
      if (previous === 0) {
        return current > 0 ? 100 : 0;
      }
      return parseFloat((((current - previous) / previous) * 100).toFixed(1));
    };

    const salesChart = [];
    const loopDate = new Date(startDate);
    while (loopDate <= endDate) {
      const dateStr = loopDate.toISOString().split('T')[0];
      const dayData = summaryData.salesByDay.find(d => d._id === dateStr) || { sales: 0, orders: 0 };
      salesChart.push({ date: dateStr, sales: dayData.sales, orders: dayData.orders });
      loopDate.setDate(loopDate.getDate() + 1);
    }

    // --- 4. Construct Final Response ---
    return success(res, 'Dashboard summary retrieved successfully', {
      metrics: {
        totalSales: currentSales,
        totalOrders: currentOrders,
        newCustomers: newCustomers,
        inventoryValue: inventoryValue,
        lowStockProducts: lowStockProducts,
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
      .lean();

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

    const activities = await User.aggregate([
      { $match: { role: 'customer' } },
      { $sort: { createdAt: -1 } },
      { $limit: limit * 2 },
      {
        $project: {
          _id: 0,
          id: '$_id',
          type: 'customer',
          message: { $concat: ['New customer registered: ', '$firstName', ' ', '$lastName'] },
          timestamp: '$createdAt'
        }
      },
      {
        $unionWith: {
          coll: 'orders',
          pipeline: [
            { $sort: { createdAt: -1 } },
            { $limit: limit * 2 },
            {
              $project: {
                _id: 0,
                id: '$_id',
                type: 'order',
                message: { $concat: ['Order #', '$orderNumber', ' was placed'] },
                timestamp: '$createdAt'
              }
            }
          ]
        }
      },
      {
        $unionWith: {
          coll: 'products',
          pipeline: [
            { $match: { stockQuantity: { $lte: 5, $gt: 0 } } },
            { $sort: { updatedAt: -1 } },
            { $limit: limit * 2 },
            {
              $project: {
                _id: 0,
                id: '$_id',
                type: 'inventory',
                message: { $concat: ['Low inventory for product: ', '$name'] },
                timestamp: '$updatedAt'
              }
            }
          ]
        }
      },
      { $sort: { timestamp: -1 } },
      { $limit: limit }
    ]);

    return success(res, 'Activity feed retrieved successfully', { activities });
  } catch (err) {
    next(err);
  }
};