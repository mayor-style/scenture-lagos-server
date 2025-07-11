const { success, error } = require('../utils/response.util');
const { ErrorResponse } = require('../middleware/error.middleware');
const Settings = require('../models/settings.model');
const Product = require('../models/product.model');

/**
 * @desc    Initialize checkout process
 * @route   POST /api/v1/checkout/initialize
 * @access  Public
 */
exports.initializeCheckout = async (req, res, next) => {
  try {
    // Check if cart exists in session
    if (!req.session.cart || !req.session.cart.items || req.session.cart.items.length === 0) {
      return next(new ErrorResponse('Your cart is empty', 400));
    }

    // Get app settings for tax rates
    const settings = await Settings.getSettings();

    // Validate cart items and check stock
    const cartItems = req.session.cart.items;
    const validatedItems = [];
    let subtotal = 0;

    for (const item of cartItems) {
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
      let variantInfo = null;

      if (item.variant) {
        const variant = product.variants.id(item.variant);

        if (!variant) {
          return next(new ErrorResponse(`Variant not found with id of ${item.variant}`, 404));
        }

        price = product.price + variant.priceAdjustment;
        stock = variant.stock;
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

      // Add to validated items
      validatedItems.push({
        product: {
          _id: product._id,
          name: product.name,
          sku: item.variant ? variantInfo.sku : product.sku,
          price,
          image: product.images.find(img => img.isMain) ? product.images.find(img => img.isMain).url : (product.images.length > 0 ? product.images[0].url : null),
        },
        variant: variantInfo,
        quantity: item.quantity,
        total: itemTotal
      });

      // Add to subtotal
      subtotal += itemTotal;
    }

    // Calculate tax
    const taxRate = settings.tax.rate || 0;
    const taxAmount = (subtotal * taxRate) / 100;

    // Create checkout session
    req.session.checkout = {
      items: validatedItems,
      subtotal,
      taxRate,
      taxAmount,
      step: 'shipping' // First step in checkout process
    };

    return success(res, 'Checkout initialized successfully', {
      checkout: req.session.checkout
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get checkout session
 * @route   GET /api/v1/checkout
 * @access  Public
 */
exports.getCheckoutSession = async (req, res, next) => {
  try {
    // Check if checkout session exists
    if (!req.session.checkout) {
      return next(new ErrorResponse('No active checkout session', 404));
    }

    return success(res, 'Checkout session retrieved successfully', {
      checkout: req.session.checkout
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Update shipping information
 * @route   POST /api/v1/checkout/shipping
 * @access  Public
 */
exports.updateShipping = async (req, res, next) => {
  try {
    // Check if checkout session exists
    if (!req.session.checkout) {
      return next(new ErrorResponse('No active checkout session', 404));
    }

    const { shippingAddress, shippingMethod } = req.body;

    // Validate input
    if (!shippingAddress) {
      return next(new ErrorResponse('Please provide shipping address', 400));
    }

    if (!shippingMethod) {
      return next(new ErrorResponse('Please provide shipping method', 400));
    }

    // Get app settings for shipping rates
    const settings = await Settings.getSettings();

    // Find shipping method
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

    // Update checkout session
    req.session.checkout.shippingAddress = shippingAddress;
    req.session.checkout.shippingMethod = {
      _id: shippingRate._id,
      name: shippingRate.name,
      cost: shippingRate.cost,
      estimatedDelivery: shippingRate.estimatedDelivery
    };
    req.session.checkout.shippingCost = shippingRate.cost;
    req.session.checkout.step = 'payment';

    // Recalculate total
    req.session.checkout.totalAmount = 
      req.session.checkout.subtotal + 
      req.session.checkout.taxAmount + 
      req.session.checkout.shippingCost;

    return success(res, 'Shipping information updated successfully', {
      checkout: req.session.checkout
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Update payment information
 * @route   POST /api/v1/checkout/payment
 * @access  Public
 */
exports.updatePayment = async (req, res, next) => {
  try {
    // Check if checkout session exists
    if (!req.session.checkout) {
      return next(new ErrorResponse('No active checkout session', 404));
    }

    const { paymentMethod } = req.body;

    // Validate input
    if (!paymentMethod) {
      return next(new ErrorResponse('Please provide payment method', 400));
    }

    // Get app settings for payment methods
    const settings = await Settings.getSettings();

    // Find payment method
    const method = settings.paymentMethods.find(m => m._id.toString() === paymentMethod);

    if (!method) {
      return next(new ErrorResponse('Invalid payment method', 400));
    }

    if (!method.isActive) {
      return next(new ErrorResponse('Selected payment method is not available', 400));
    }

    // Update checkout session
    req.session.checkout.paymentMethod = {
      _id: method._id,
      name: method.name
    };
    req.session.checkout.step = 'review';

    return success(res, 'Payment information updated successfully', {
      checkout: req.session.checkout
    });
  } catch (err) {
    next(err);
  }
};