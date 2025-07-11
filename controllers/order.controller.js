const Order = require('../models/order.model');
const Product = require('../models/product.model');
const Settings = require('../models/settings.model');
const { ErrorResponse } = require('../middleware/error.middleware');
const { success, error } = require('../utils/response.util');

/**
 * @desc    Create new order
 * @route   POST /api/v1/orders
 * @access  Private/Customer
 */
exports.createOrder = async (req, res, next) => {
  try {
    const { 
      items, 
      shippingAddress, 
      paymentMethod,
      shippingMethod
    } = req.body;

    // Validate input
    if (!items || !Array.isArray(items) || items.length === 0) {
      return next(new ErrorResponse('Please provide order items', 400));
    }

    if (!shippingAddress) {
      return next(new ErrorResponse('Please provide shipping address', 400));
    }

    if (!paymentMethod) {
      return next(new ErrorResponse('Please provide payment method', 400));
    }

    if (!shippingMethod) {
      return next(new ErrorResponse('Please provide shipping method', 400));
    }

    // Get app settings for tax and shipping rates
    const settings = await Settings.getSettings();

    // Validate and calculate order items
    const orderItems = [];
    let subtotal = 0;

    for (const item of items) {
      const product = await Product.findById(item.product);

      if (!product) {
        return next(new ErrorResponse(`Product not found with id of ${item.product}`, 404));
      }

      // Check if product is active
      if (product.status !== 'active') {
        return next(new ErrorResponse(`Product ${product.name} is currently unavailable`, 400));
      }

      // Determine price and stock based on variant or main product
      let price = product.price;
      let stock = product.stockQuantity;
      let sku = product.sku;
      let variantInfo = null;

      if (item.variant) {
        const variant = product.variants.id(item.variant);

        if (!variant) {
          return next(new ErrorResponse(`Variant not found with id of ${item.variant}`, 404));
        }

        price = product.price + variant.priceAdjustment;
        stock = variant.stock;
        sku = variant.sku;
        variantInfo = {
          _id: variant._id,
          size: variant.size,
          scentIntensity: variant.scentIntensity,
          sku: variant.sku,
          priceAdjustment: variant.priceAdjustment
        };
      }

      // Check if there's enough stock
      if (item.quantity > stock) {
        return next(new ErrorResponse(`Not enough stock for ${product.name}. Only ${stock} available.`, 400));
      }

      // Calculate item total
      const itemTotal = price * item.quantity;

      // Add to order items
      orderItems.push({
        product: product._id,
        name: product.name,
        sku,
        price,
        quantity: item.quantity,
        variant: variantInfo,
        image: product.images.find(img => img.isMain) ? product.images.find(img => img.isMain).url : (product.images.length > 0 ? product.images[0].url : null),
        total: itemTotal
      });

      // Add to subtotal
      subtotal += itemTotal;
    }

    // Calculate shipping cost based on shipping method
    const shippingZone = settings.shippingZones.find(zone => 
      zone.rates.some(rate => rate._id.toString() === shippingMethod)
    );

    if (!shippingZone) {
      return next(new ErrorResponse('Invalid shipping method', 400));
    }

    const shippingRate = shippingZone.rates.find(rate => rate._id.toString() === shippingMethod);

    if (!shippingRate) {
      return next(new ErrorResponse('Invalid shipping method', 400));
    }

    const shippingCost = shippingRate.cost;

    // Calculate tax
    const taxRate = settings.tax.rate || 0;
    const taxAmount = (subtotal * taxRate) / 100;

    // Calculate total
    const totalAmount = subtotal + shippingCost + taxAmount;

    // Create order
    const order = await Order.create({
      user: req.user.id,
      items: orderItems,
      shippingAddress,
      shippingMethod: {
        name: shippingRate.name,
        cost: shippingCost
      },
      paymentInfo: {
        method: paymentMethod,
        status: 'pending'
      },
      subtotal,
      taxAmount,
      taxRate,
      shippingCost,
      totalAmount,
      status: 'pending',
      timeline: [
        {
          status: 'pending',
          date: Date.now(),
          description: 'Order placed'
        }
      ]
    });

    // Update product stock
    for (const item of items) {
      const product = await Product.findById(item.product);

      if (item.variant) {
        // Update variant stock
        const variant = product.variants.id(item.variant);
        variant.stock -= item.quantity;
      } else {
        // Update main product stock
        product.stockQuantity -= item.quantity;
      }

      // Increment sales count
      product.salesCount = (product.salesCount || 0) + item.quantity;

      await product.save();
    }

    // Clear cart after successful order
    if (req.session.cart) {
      req.session.cart = {
        items: [],
        totalItems: 0,
        subtotal: 0
      };
    }

    return success(res, 'Order created successfully', { order });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get shipping methods
 * @route   GET /api/v1/orders/shipping-methods
 * @access  Public
 */
exports.getShippingMethods = async (req, res, next) => {
  try {
    const { region } = req.query;

    if (!region) {
      return next(new ErrorResponse('Please provide a region', 400));
    }

    // Get app settings
    const settings = await Settings.getSettings();

    // Find shipping zones that include the region
    const applicableZones = settings.shippingZones.filter(zone => 
      zone.regions.includes(region)
    );

    if (applicableZones.length === 0) {
      return next(new ErrorResponse(`No shipping methods available for region: ${region}`, 404));
    }

    // Extract shipping methods from applicable zones
    const shippingMethods = applicableZones.flatMap(zone => 
      zone.rates.map(rate => ({
        id: rate._id,
        name: rate.name,
        cost: rate.cost,
        description: rate.description,
        estimatedDelivery: rate.estimatedDelivery,
        zone: zone.name
      }))
    );

    return success(res, 'Shipping methods retrieved successfully', { shippingMethods });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get payment methods
 * @route   GET /api/v1/orders/payment-methods
 * @access  Public
 */
exports.getPaymentMethods = async (req, res, next) => {
  try {
    // Get app settings
    const settings = await Settings.getSettings();

    // Get active payment methods
    const paymentMethods = settings.paymentMethods
      .filter(method => method.isActive)
      .map(method => ({
        id: method._id,
        name: method.name,
        description: method.description
      }));

    return success(res, 'Payment methods retrieved successfully', { paymentMethods });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Process payment
 * @route   POST /api/v1/orders/:id/payment
 * @access  Private/Customer
 */
exports.processPayment = async (req, res, next) => {
  try {
    const { paymentDetails } = req.body;

    // Find order
    const order = await Order.findById(req.params.id);

    if (!order) {
      return next(new ErrorResponse(`Order not found with id of ${req.params.id}`, 404));
    }

    // Check if order belongs to user
    if (order.user.toString() !== req.user.id) {
      return next(new ErrorResponse('Not authorized to access this order', 401));
    }

    // Check if order is already paid
    if (order.paymentInfo.status === 'paid') {
      return next(new ErrorResponse('Order is already paid', 400));
    }

    // In a real application, you would integrate with a payment gateway here
    // For this example, we'll simulate a successful payment

    // Update payment info
    order.paymentInfo.status = 'paid';
    order.paymentInfo.paidAt = Date.now();
    order.paymentInfo.transactionId = `TR-${Date.now()}`;
    order.paymentInfo.details = paymentDetails;

    // Update order status
    order.status = 'processing';

    // Add to timeline
    order.timeline.push({
      status: 'processing',
      date: Date.now(),
      description: 'Payment received, order is being processed'
    });

    await order.save();

    return success(res, 'Payment processed successfully', { order });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get order by ID
 * @route   GET /api/v1/orders/:id
 * @access  Private/Customer
 */
exports.getOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return next(new ErrorResponse(`Order not found with id of ${req.params.id}`, 404));
    }

    // Check if order belongs to user
    if (order.user.toString() !== req.user.id) {
      return next(new ErrorResponse('Not authorized to access this order', 401));
    }

    return success(res, 'Order retrieved successfully', { order });
  } catch (err) {
    next(err);
  }
};