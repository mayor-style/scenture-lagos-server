const Product = require('../models/product.model');
const { ErrorResponse } = require('../middleware/error.middleware');
const { success, error } = require('../utils/response.util');

/**
 * @desc    Add item to cart
 * @route   POST /api/v1/cart
 * @access  Public
 */
exports.addToCart = async (req, res, next) => {
  try {
    const { productId, quantity, variantId } = req.body;

    // Validate input
    if (!productId) {
      return next(new ErrorResponse('Please provide a product ID', 400));
    }

    if (!quantity || quantity <= 0) {
      return next(new ErrorResponse('Please provide a valid quantity', 400));
    }

    // Find product
    const product = await Product.findById(productId);

    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${productId}`, 404));
    }

    // Check if product is active
    if (product.status !== 'active') {
      return next(new ErrorResponse('This product is currently unavailable', 400));
    }

    // Initialize cart if it doesn't exist in session
    if (!req.session.cart) {
      req.session.cart = {
        items: [],
        totalItems: 0,
        subtotal: 0
      };
    }

    // Check if we're adding a variant or the main product
    let itemPrice = product.price;
    let itemStock = product.stockQuantity;
    let itemSku = product.sku;
    let variantInfo = null;

    if (variantId) {
      // Find the variant
      const variant = product.variants.id(variantId);

      if (!variant) {
        return next(new ErrorResponse(`Variant not found with id of ${variantId}`, 404));
      }

      // Update price, stock, and SKU with variant info
      itemPrice = product.price + variant.priceAdjustment;
      itemStock = variant.stock;
      itemSku = variant.sku;
      variantInfo = {
        _id: variant._id,
        size: variant.size,
        scentIntensity: variant.scentIntensity,
        sku: variant.sku,
        priceAdjustment: variant.priceAdjustment
      };
    }

    // Check if there's enough stock
    if (quantity > itemStock) {
      return next(new ErrorResponse(`Not enough stock available. Only ${itemStock} items left.`, 400));
    }

    // Check if item already exists in cart
    const cartItemIndex = req.session.cart.items.findIndex(item => {
      if (variantId) {
        return item.product.toString() === productId && item.variant && item.variant._id.toString() === variantId;
      } else {
        return item.product.toString() === productId && !item.variant;
      }
    });

    if (cartItemIndex > -1) {
      // Update existing item
      const updatedQuantity = req.session.cart.items[cartItemIndex].quantity + quantity;
      
      // Check if updated quantity exceeds stock
      if (updatedQuantity > itemStock) {
        return next(new ErrorResponse(`Cannot add ${quantity} more items. Only ${itemStock - req.session.cart.items[cartItemIndex].quantity} more available.`, 400));
      }
      
      req.session.cart.items[cartItemIndex].quantity = updatedQuantity;
      req.session.cart.items[cartItemIndex].total = updatedQuantity * itemPrice;
    } else {
      // Add new item to cart
      req.session.cart.items.push({
        product: productId,
        productName: product.name,
        productSlug: product.slug,
        productImage: product.images.find(img => img.isMain) ? product.images.find(img => img.isMain).url : (product.images.length > 0 ? product.images[0].url : null),
        variant: variantInfo,
        sku: itemSku,
        price: itemPrice,
        quantity,
        total: quantity * itemPrice
      });
    }

    // Update cart totals
    req.session.cart.totalItems = req.session.cart.items.reduce((total, item) => total + item.quantity, 0);
    req.session.cart.subtotal = req.session.cart.items.reduce((total, item) => total + item.total, 0);

    return success(res, 'Item added to cart', { cart: req.session.cart });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get cart
 * @route   GET /api/v1/cart
 * @access  Public
 */
exports.getCart = async (req, res, next) => {
  try {
    // Initialize cart if it doesn't exist in session
    if (!req.session.cart) {
      req.session.cart = {
        items: [],
        totalItems: 0,
        subtotal: 0
      };
    }

    return success(res, 'Cart retrieved successfully', { cart: req.session.cart });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Update cart item
 * @route   PUT /api/v1/cart/:itemId
 * @access  Public
 */
exports.updateCartItem = async (req, res, next) => {
  try {
    const { quantity } = req.body;
    const { itemId } = req.params;

    // Validate input
    if (!quantity || quantity <= 0) {
      return next(new ErrorResponse('Please provide a valid quantity', 400));
    }

    // Check if cart exists
    if (!req.session.cart || !req.session.cart.items || req.session.cart.items.length === 0) {
      return next(new ErrorResponse('Cart is empty', 400));
    }

    // Find item in cart
    const itemIndex = req.session.cart.items.findIndex(item => item._id.toString() === itemId);

    if (itemIndex === -1) {
      return next(new ErrorResponse(`Item not found in cart with id of ${itemId}`, 404));
    }

    // Get the item
    const cartItem = req.session.cart.items[itemIndex];

    // Check product stock
    let itemStock;
    
    if (cartItem.variant) {
      // Get variant stock
      const product = await Product.findById(cartItem.product);
      if (!product) {
        return next(new ErrorResponse(`Product not found with id of ${cartItem.product}`, 404));
      }
      
      const variant = product.variants.id(cartItem.variant._id);
      if (!variant) {
        return next(new ErrorResponse(`Variant not found with id of ${cartItem.variant._id}`, 404));
      }
      
      itemStock = variant.stock;
    } else {
      // Get product stock
      const product = await Product.findById(cartItem.product);
      if (!product) {
        return next(new ErrorResponse(`Product not found with id of ${cartItem.product}`, 404));
      }
      
      itemStock = product.stockQuantity;
    }

    // Check if there's enough stock
    if (quantity > itemStock) {
      return next(new ErrorResponse(`Not enough stock available. Only ${itemStock} items left.`, 400));
    }

    // Update item quantity and total
    req.session.cart.items[itemIndex].quantity = quantity;
    req.session.cart.items[itemIndex].total = quantity * cartItem.price;

    // Update cart totals
    req.session.cart.totalItems = req.session.cart.items.reduce((total, item) => total + item.quantity, 0);
    req.session.cart.subtotal = req.session.cart.items.reduce((total, item) => total + item.total, 0);

    return success(res, 'Cart item updated successfully', { cart: req.session.cart });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Remove item from cart
 * @route   DELETE /api/v1/cart/:itemId
 * @access  Public
 */
exports.removeCartItem = async (req, res, next) => {
  try {
    const { itemId } = req.params;

    // Check if cart exists
    if (!req.session.cart || !req.session.cart.items || req.session.cart.items.length === 0) {
      return next(new ErrorResponse('Cart is empty', 400));
    }

    // Find item in cart
    const itemIndex = req.session.cart.items.findIndex(item => item._id.toString() === itemId);

    if (itemIndex === -1) {
      return next(new ErrorResponse(`Item not found in cart with id of ${itemId}`, 404));
    }

    // Remove item from cart
    req.session.cart.items.splice(itemIndex, 1);

    // Update cart totals
    req.session.cart.totalItems = req.session.cart.items.reduce((total, item) => total + item.quantity, 0);
    req.session.cart.subtotal = req.session.cart.items.reduce((total, item) => total + item.total, 0);

    return success(res, 'Item removed from cart', { cart: req.session.cart });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Clear cart
 * @route   DELETE /api/v1/cart
 * @access  Public
 */
exports.clearCart = async (req, res, next) => {
  try {
    // Reset cart
    req.session.cart = {
      items: [],
      totalItems: 0,
      subtotal: 0
    };

    return success(res, 'Cart cleared successfully', { cart: req.session.cart });
  } catch (err) {
    next(err);
  }
};