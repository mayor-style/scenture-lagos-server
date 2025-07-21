const Order = require('../models/order.model');
const Product = require('../models/product.model');
const Settings = require('../models/settings.model');
const { ErrorResponse } = require('../middleware/error.middleware');
const { success } = require('../utils/response.util');
const paystackUtil = require('../utils/paystack.util');


const generateOrderNumber = () => {
    // Generates a number like: ORD-1678886400000-AB12C
    const timestamp = Date.now();
    const randomComponent = Math.random().toString(36).substring(2, 7).toUpperCase();
    return `ORD-${timestamp}-${randomComponent}`;
};

/**
 * @desc    Create new order
 * @route   POST /api/v1/orders
 * @access  Public
 */
exports.createOrder = async (req, res, next) => {
  try {
    const { items, shippingAddress, paymentMethod, shippingRateId } = req.body;

    // --- 1. VALIDATE INPUT ---
    if (!items || !Array.isArray(items) || items.length === 0) {
      return next(new ErrorResponse('Your cart is empty.', 400));
    }
    if (!shippingAddress || !shippingAddress.state || !shippingAddress.email) {
      return next(new ErrorResponse('Please provide a complete shipping address including state and email.', 400));
    }
    if (!paymentMethod) {
      return next(new ErrorResponse('Please select a payment method.', 400));
    }
    if (!shippingRateId) {
      return next(new ErrorResponse('Please select a shipping method.', 400));
    }

    // --- 2. GET SETTINGS & VALIDATE SHIPPING RATE ---
    const settings = await Settings.getSettings();
    let selectedRate, shippingZone;

    // Find the specific shipping rate and its parent zone.
    for (const zone of settings.shipping.zones) {
        const rate = zone.shippingRates.id(shippingRateId);
        if (rate) {
            selectedRate = rate;
            shippingZone = zone;
            break;
        }
    }

    if (!selectedRate || !shippingZone || !selectedRate.active || !shippingZone.active) {
        return next(new ErrorResponse('The selected shipping method is invalid or unavailable.', 400));
    }
    
    // Ensure the selected zone matches the customer's state
    if (!shippingZone.regions.includes(shippingAddress.state) && !shippingZone.regions.includes('Others')) {
        return next(new ErrorResponse('The selected shipping method is not available for your state.', 400));
    }

    // --- 3. VALIDATE PRODUCTS & CALCULATE SUBTOTAL ---
    const orderItems = [];
    let subtotal = 0;
    const productIds = items.map(item => item.product);
    const products = await Product.find({ '_id': { $in: productIds } });
    const productMap = new Map(products.map(p => [p._id.toString(), p]));

    for (const item of items) {
      const product = productMap.get(item.product);
      if (!product) {
        return next(new ErrorResponse(`Product not found.`, 404));
      }
      if (product.status !== 'published') {
        return next(new ErrorResponse(`Product "${product.name}" is currently unavailable.`, 400));
      }

      let price = product.price;
      let stock = product.stockQuantity;
      let sku = product.sku;
      let variantInfo = null;

      if (item.variant) {
        const variant = product.variants.id(item.variant);
        if (!variant) {
          return next(new ErrorResponse(`Selected variant for "${product.name}" not found.`, 404));
        }
        price = product.price + variant.priceAdjustment;
        stock = variant.stockQuantity; // Corrected from 'stock'
        sku = variant.sku;
        variantInfo = { _id: variant._id, size: variant.size, scentIntensity: variant.scentIntensity };
      }

      if (item.quantity > stock) {
        return next(new ErrorResponse(`Not enough stock for "${product.name}". Only ${stock} available.`, 400));
      }

      const itemTotal = price * item.quantity;
      orderItems.push({
        product: product._id,
        name: product.name,
        sku,
        price,
        quantity: item.quantity,
        variant: variantInfo,
        image: product.images.find(img => img.isMain)?.url || product.images[0]?.url,
        total: itemTotal
      });
      subtotal += itemTotal;
    }

    // --- 4. CALCULATE FINAL TOTALS ---
    const shippingFee = subtotal >= (selectedRate.freeShippingThreshold || Infinity) ? 0 : selectedRate.price;
    const taxRate = settings.tax.enabled ? settings.tax.rate : 0;
    const taxAmount = (subtotal * taxRate) / 100;
    const totalAmount = subtotal + shippingFee + taxAmount;

    // --- 5. CREATE ORDER IN DATABASE ---
    const order = await Order.create({
      orderNumber: generateOrderNumber(),
      user: req.user?.id || null,
      items: orderItems,
      shippingAddress,
      shippingMethod: {
        name: selectedRate.name,
        rateId: selectedRate._id,
        price: shippingFee, // Store the actual fee charged
        description: selectedRate.description
      },
      paymentInfo: { method: paymentMethod, status: 'pending' },
      subtotal,
      shippingFee,
      taxAmount,
      taxRate,
      totalAmount,
      status: 'pending',
      timeline: [{ status: 'pending', date: Date.now(), description: 'Order placed by customer.' }]
    });

    console.log('order created', order)
    // --- 6. UPDATE PRODUCT STOCK (ATOMICALLY) ---
    const stockUpdatePromises = items.map(item => {
      const update = {
        $inc: {
          'salesCount': item.quantity,
          ...(item.variant
            ? { 'variants.$[v].stockQuantity': -item.quantity }
            : { 'stockQuantity': -item.quantity })
        }
      };
      const options = item.variant ? { arrayFilters: [{ 'v._id': item.variant }] } : {};
      return Product.findByIdAndUpdate(item.product, update, options);
    });
    await Promise.all(stockUpdatePromises);
    
    // Optional: Clear guest cart from session if you implement that
    if (!req.user && req.session.cart) {
      req.session.cart = { items: [], totalItems: 0, subtotal: 0 };
    }

    return success(res, 'Order created successfully. Proceed to payment.', { order }, 201);
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get available shipping rates for a given state
 * @route   GET /api/v1/orders/shipping-rates
 * @access  Public
 * @query   state (e.g., "Lagos")
 */
exports.getShippingRates = async (req, res, next) => {
  try {
    const { state } = req.query;
    if (!state) {
      return next(new ErrorResponse('Please provide a state for shipping calculation', 400));
    }

    const settings = await Settings.getSettings();
    const { zones } = settings.shipping;

    // Find the shipping zone that includes the provided state.
    let applicableZone = zones.find(zone => zone.active && zone.regions.includes(state));

    // If no specific zone is found, fall back to a zone that includes 'Others'.
    if (!applicableZone) {
      applicableZone = zones.find(zone => zone.active && zone.regions.includes('Others'));
    }

    if (!applicableZone || applicableZone.shippingRates.length === 0) {
      return next(new ErrorResponse(`Sorry, we do not ship to ${state} at the moment.`, 404));
    }

    // Filter for active rates within the zone and format the response.
    const shippingRates = applicableZone.shippingRates
      .filter(rate => rate.active)
      .map(rate => ({
        id: rate._id,
        name: rate.name,
        price: rate.price,
        description: rate.description,
        freeShippingThreshold: rate.freeShippingThreshold,
      }));

    if (shippingRates.length === 0) {
        return next(new ErrorResponse(`No active shipping methods available for ${state}.`, 404));
    }

    return success(res, 'Shipping rates retrieved successfully', { shippingRates });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Initialize Paystack payment for an order
 * @route   POST /api/v1/orders/:id/initialize-payment
 * @access  Public
 */
exports.initializePayment = async (req, res, next) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) {
            return next(new ErrorResponse(`Order not found`, 404));
        }

        if (order.paymentInfo.status === 'paid') {
            return next(new ErrorResponse('This order has already been paid for.', 400));
        }
        
        // Use the generated unique order number for the reference for easy reconciliation
        const reference = order.orderNumber;
        const paymentData = {
            amount: Math.round(order.totalAmount * 100), // Ensure it's an integer in kobo
            email: order.shippingAddress.email,
            reference: reference,
            // The callback URL should ideally point to a page that triggers the verification
            callback_url: `${process.env.CLIENT_URL}/order-status?reference=${reference}`,
            metadata: {
                orderId: order._id.toString(),
                orderNumber: order.orderNumber,
                customerName: `${order.shippingAddress.firstName} ${order.shippingAddress.lastName}`
            }
        };

        const paystackResponse = await paystackUtil.initializeTransaction(paymentData);
        
        // Save the reference to the order
        order.paymentInfo.reference = reference;
        await order.save();

        return success(res, 'Payment initialized successfully', {
            authorization_url: paystackResponse.data.authorization_url,
            reference: paystackResponse.data.reference,
            access_code: paystackResponse.data.access_code
        });
    } catch (err) {
        // Handle potential Paystack API errors
        if (err.response && err.response.data) {
             return next(new ErrorResponse(err.response.data.message, 400));
        }
        next(err);
    }
};


/**
 * @desc    Verify Paystack payment
 * @route   GET /api/v1/orders/verify-payment/:reference
 * @access  Public
 */
exports.verifyPayment = async (req, res, next) => {
    try {
        const { reference } = req.params;
        if (!reference) {
            return next(new ErrorResponse('Payment reference is required.', 400));
        }

        const verificationResponse = await paystackUtil.verifyTransaction(reference);
        const { status, data } = verificationResponse;

        if (data.status !== 'success') {
            return next(new ErrorResponse('Payment verification failed. Please contact support.', 400));
        }

        // Find order by the reference, which is our unique order number
        const order = await Order.findOne({ 'paymentInfo.reference': reference });
        if (!order) {
            return next(new ErrorResponse('Order not found for this payment reference.', 404));
        }

        // --- CRITICAL: Verify amount paid matches order total ---
        const amountPaidInKobo = data.amount;
        const orderTotalInKobo = Math.round(order.totalAmount * 100);
        if (amountPaidInKobo < orderTotalInKobo) {
            // This is a security risk. Log this event for manual review.
            console.error(`SECURITY ALERT: Partial payment detected for order ${order.orderNumber}. Expected ${orderTotalInKobo}, received ${amountPaidInKobo}.`);
            // You might want to flag the order for manual intervention
            return next(new ErrorResponse('Payment amount mismatch. Please contact support.', 400));
        }

        // Idempotency check: If already verified, just return success
        if (order.paymentInfo.status === 'paid') {
            return success(res, 'Payment already verified.', { order });
        }

        // --- Update Order Status ---
        order.paymentInfo.status = 'paid';
        order.paymentInfo.paidAt = new Date(data.paid_at);
        order.paymentInfo.transactionId = data.id.toString();
        order.paymentInfo.details = {
            channel: data.channel,
            bank: data.authorization?.bank,
            card_type: data.authorization?.card_type,
            last4: data.authorization?.last4,
        };
        order.status = 'processing';
        order.timeline.push({
            status: 'processing',
            description: 'Payment successful. Order is now being processed.'
        });

        await order.save();
        
        // TODO: Send order confirmation email here

        return success(res, 'Payment verified successfully. Your order is confirmed!', { order });
    } catch (err) {
        next(err);
    }
};

/**
 * @desc    Get order by ID
 * @route   GET /api/v1/orders/:id
 * @access  Public
 */
exports.getOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return next(new ErrorResponse(`Order not found with id of ${req.params.id}`, 404));
    }
    return success(res, 'Order retrieved successfully', { order });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get logged in user's orders
 * @route   GET /api/v1/orders/my-orders
 * @access  Private
 */
exports.getMyOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({ user: req.user.id }).sort('-createdAt');

    if (!orders) {
        return next(new ErrorResponse('Could not find any orders for this user.', 404));
    }
    
    return success(res, 'User orders retrieved successfully', { orders });
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
    const settings = await Settings.getSettings();
    const paymentMethods = settings.payment.methods
      .filter(method => method.active)
      .map(method => ({
        id: method._id,
        name: method.name,
        displayName: method.displayName,
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
 * @access  Public
 */
exports.processPayment = async (req, res, next) => {
  try {
    const { paymentDetails } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) {
      return next(new ErrorResponse(`Order not found with id of ${req.params.id}`, 404));
    }
    if (order.paymentInfo.status === 'paid') {
      return next(new ErrorResponse('Order is already paid', 400));
    }

    order.paymentInfo.status = 'paid';
    order.paymentInfo.paidAt = Date.now();
    order.paymentInfo.transactionId = `TR-${Date.now()}`;
    order.paymentInfo.details = paymentDetails;
    order.status = 'processing';
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
 * @desc    Cancel an order
 * @route   POST /api/v1/orders/:id/cancel
 * @access  Private
 */
exports.cancelOrder = async (req, res, next) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return next(new ErrorResponse(`Order not found`, 404));
        }

        // Authorization: Ensure the user owns the order or is an admin
        if (order.user.toString() !== req.user.id && req.user.role !== 'admin') {
            return next(new ErrorResponse(`Not authorized to cancel this order`, 401));
        }

        // Business logic: An order can only be cancelled if it's pending or processing
        if (order.status !== 'pending' && order.status !== 'processing') {
            return next(new ErrorResponse(`Cannot cancel order. It has already been ${order.status}.`, 400));
        }

        order.status = 'cancelled';
        order.timeline.push({
            status: 'cancelled',
            description: `Order cancelled by ${req.user.role === 'admin' ? 'admin' : 'customer'}.`,
            updatedBy: req.user.id,
        });

        // --- IMPORTANT: Restore Product Stock ---
        const stockUpdatePromises = order.items.map(item => {
            const update = {
                $inc: {
                    'salesCount': -item.quantity,
                    ...(item.variant
                        ? { 'variants.$[v].stockQuantity': item.quantity }
                        // The 'stockQuantity' here should refer to the base product if no variant
                        : { 'stockQuantity': item.quantity }) 
                }
            };
            const options = item.variant ? { arrayFilters: [{ 'v._id': item.variant._id }] } : {};
            return Product.findByIdAndUpdate(item.product, update, options);
        });
        await Promise.all(stockUpdatePromises);

        await order.save();

        // TODO: Send order cancellation email
        
        return success(res, 'Order cancelled successfully', { order });
    } catch (err) {
        next(err);
    }
};

/**
 * @desc    Get order tracking information (timeline)
 * @route   GET /api/v1/orders/:id/tracking
 * @access  Public (or Private, depending on your needs)
 */
exports.trackOrder = async (req, res, next) => {
    try {
        const order = await Order.findById(req.params.id).select('orderNumber status timeline');

        if (!order) {
            return next(new ErrorResponse(`No order found with that ID`, 404));
        }

        return success(res, 'Tracking information retrieved', {
            orderNumber: order.orderNumber,
            status: order.status,
            timeline: order.timeline
        });
    } catch (err) {
        next(err);
    }
};