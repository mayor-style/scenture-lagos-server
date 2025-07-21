const Product = require('../models/product.model');
const Cart = require('../models/cart.model');
const Category = require('../models/category.model')
const { ErrorResponse } = require('../middleware/error.middleware');
const { success } = require('../utils/response.util');

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
    const product = await Product.findById(productId).lean();
    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${productId}`, 404));
    }
    if (product.status !== 'published') {
      return next(new ErrorResponse('This product is currently unavailable', 400));
    }

    // Initialize cart
    let cart;
    if (req.user) {
      cart = await Cart.findOne({ user: req.user.id });
      if (!cart) {
        cart = new Cart({ user: req.user.id, items: [] });
      }
    } else {
      cart = req.session.cart || { items: [], totalItems: 0, subtotal: 0, discount: 0, total: 0, coupon: null };
    }

    const category = await Category.findById(product.category).select('name')
    // Determine price, stock, SKU, and category
    let itemPrice = product.price;
    let itemStock = product.stockQuantity;
    let itemSku = product.sku;
    let variantInfo = null;
    let itemCategory = category.name || 'Uncategorized'; // Fetch category from product

    if (variantId) {
      const variant = product.variants?.find((v) => v._id.toString() === variantId);
      if (!variant) {
        return next(new ErrorResponse(`Variant not found with id of ${variantId}`, 404));
      }
      itemPrice = product.price + (variant.priceAdjustment || 0);
      itemStock = variant.stock;
      itemSku = variant.sku;
      variantInfo = {
        _id: variant._id,
        size: variant.size,
        scentIntensity: variant.scentIntensity,
        sku: variant.sku,
        priceAdjustment: variant.priceAdjustment,
      };
    }

    // Check stock
    if (quantity > itemStock) {
      return next(new ErrorResponse(`Not enough stock available. Only ${itemStock} items left.`, 400));
    }

    // Check if item exists in cart
    const cartItemIndex = cart.items.findIndex(
      (item) =>
        item.product.toString() === productId &&
        ((variantId && item.variant?._id.toString() === variantId) || (!variantId && !item.variant))
    );

    if (cartItemIndex > -1) {
      // Update existing item
      const updatedQuantity = cart.items[cartItemIndex].quantity + quantity;
      if (updatedQuantity > itemStock) {
        return next(
          new ErrorResponse(
            `Cannot add ${quantity} more items. Only ${
              itemStock - cart.items[cartItemIndex].quantity
            } more available.`,
            400
          )
        );
      }
      cart.items[cartItemIndex].quantity = updatedQuantity;
      cart.items[cartItemIndex].total = updatedQuantity * itemPrice;
    } else {
      // Add new item
      cart.items.push({
        _id: req.user ? new mongoose.Types.ObjectId() : `${productId}${variantId ? `-${variantId}` : ''}`,
        product: productId,
        productName: product.name,
        productSlug: product.slug,
        productImage: product.images.find((img) => img.isMain)?.url || (product.images[0]?.url || null),
        category: itemCategory, // Add category to cart item
        variant: variantInfo,
        sku: itemSku,
        price: itemPrice,
        quantity,
        total: quantity * itemPrice,
      });
    }

    // Update totals
    cart.totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0);
    cart.subtotal = cart.items.reduce((sum, item) => sum + item.total, 0);
    cart.total = cart.subtotal - (cart.discount || 0);

    // Save cart for authenticated users or update session for guests
    if (req.user) {
      await cart.save();
    } else {
      req.session.cart = cart;
    }

    return success(res, 'Item added to cart', { cart });
  } catch (err) {
    next(new ErrorResponse(err.message || 'Server error', 500));
  }
};

/**
 * @desc    Get cart
 * @route   GET /api/v1/cart
 * @access  Public
 */
exports.getCart = async (req, res, next) => {
  try {
    let cart;
    if (req.user) {
      cart = await Cart.findOne({ user: req.user.id }).lean();
      if (!cart) {
        cart = { items: [], totalItems: 0, subtotal: 0, discount: 0, total: 0, coupon: null };
      }
    } else {
      cart = req.session.cart || { items: [], totalItems: 0, subtotal: 0, discount: 0, total: 0, coupon: null };
    }
    return success(res, 'Cart retrieved successfully', { cart });
  } catch (err) {
    next(new ErrorResponse(err.message || 'Server error', 500));
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

    if (!quantity || quantity <= 0) {
      return next(new ErrorResponse('Please provide a valid quantity', 400));
    }

    let cart;
    if (req.user) {
      cart = await Cart.findOne({ user: req.user.id });
      if (!cart) {
        return next(new ErrorResponse('Cart not found', 404));
      }
    } else {
      cart = req.session.cart || { items: [], totalItems: 0, subtotal: 0, discount: 0, total: 0, coupon: null };
    }

    const itemIndex = cart.items.findIndex((item) => item._id.toString() === itemId);
    if (itemIndex === -1) {
      return next(new ErrorResponse(`Item not found in cart with id of ${itemId}`, 404));
    }

    const cartItem = cart.items[itemIndex];
    const product = await Product.findById(cartItem.product).lean();
    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${cartItem.product}`, 404));
    }

    let itemStock = product.stockQuantity;
    if (cartItem.variant) {
      const variant = product.variants?.find((v) => v._id.toString() === cartItem.variant._id.toString());
      if (!variant) {
        return next(new ErrorResponse(`Variant not found with id of ${cartItem.variant._id}`, 404));
      }
      itemStock = variant.stock;
    }

    if (quantity > itemStock) {
      return next(new ErrorResponse(`Not enough stock available. Only ${itemStock} items left.`, 400));
    }

    cart.items[itemIndex].quantity = quantity;
    cart.items[itemIndex].total = quantity * cartItem.price;

    cart.totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0);
    cart.subtotal = cart.items.reduce((sum, item) => sum + item.total, 0);
    cart.total = cart.subtotal - (cart.discount || 0);

    if (req.user) {
      await cart.save();
    } else {
      req.session.cart = cart;
    }

    return success(res, 'Cart item updated successfully', { cart });
  } catch (err) {
    next(new ErrorResponse(err.message || 'Server error', 500));
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

    let cart;
    if (req.user) {
      cart = await Cart.findOne({ user: req.user.id });
      if (!cart) {
        return next(new ErrorResponse('Cart not found', 404));
      }
    } else {
      cart = req.session.cart || { items: [], totalItems: 0, subtotal: 0, discount: 0, total: 0, coupon: null };
    }

    const itemIndex = cart.items.findIndex((item) => item._id.toString() === itemId);
    if (itemIndex === -1) {
      return next(new ErrorResponse(`Item not found in cart with id of ${itemId}`, 404));
    }

    cart.items.splice(itemIndex, 1);

    cart.totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0);
    cart.subtotal = cart.items.reduce((sum, item) => sum + item.total, 0);
    cart.total = cart.subtotal - (cart.discount || 0);

    if (req.user) {
      await cart.save();
    } else {
      req.session.cart = cart;
    }

    return success(res, 'Item removed from cart', { cart });
  } catch (err) {
    next(new ErrorResponse(err.message || 'Server error', 500));
  }
};

/**
 * @desc    Clear cart
 * @route   DELETE /api/v1/cart
 * @access  Public
 */
exports.clearCart = async (req, res, next) => {
  try {
    let cart;
    if (req.user) {
      cart = await Cart.findOne({ user: req.user.id });
      if (cart) {
        cart.items = [];
        cart.totalItems = 0;
        cart.subtotal = 0;
        cart.discount = 0;
        cart.total = 0;
        cart.coupon = null;
        await cart.save();
      } else {
        cart = { items: [], totalItems: 0, subtotal: 0, discount: 0, total: 0, coupon: null };
      }
    } else {
      cart = { items: [], totalItems: 0, subtotal: 0, discount: 0, total: 0, coupon: null };
      req.session.cart = cart;
    }

    return success(res, 'Cart cleared successfully', { cart });
  } catch (err) {
    next(new ErrorResponse(err.message || 'Server error', 500));
  }
};

/**
 * @desc    Apply coupon to cart
 * @route   POST /api/v1/cart/coupon
 * @access  Private/Customer
 */
exports.applyCoupon = async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) {
      return next(new ErrorResponse('Please provide a coupon code', 400));
    }
    if (!req.user) {
      return next(new ErrorResponse('Authentication required to apply coupon', 401));
    }

    const cart = await Cart.findOne({ user: req.user.id });
    if (!cart) {
      return next(new ErrorResponse('Cart not found', 404));
    }

    // Mock coupon validation
    const discount = code === 'SAVE10' ? 10 : 0;
    if (!discount) {
      return next(new ErrorResponse('Invalid coupon code', 400));
    }

    cart.coupon = { code, discount };
    cart.discount = (cart.subtotal * discount) / 100;
    cart.total = cart.subtotal - cart.discount;

    await cart.save();
    return success(res, 'Coupon applied successfully', { cart });
  } catch (err) {
    next(new ErrorResponse(err.message || 'Server error', 500));
  }
};

/**
 * @desc    Remove coupon from cart
 * @route   DELETE /api/v1/cart/coupon
 * @access  Private/Customer
 */
exports.removeCoupon = async (req, res, next) => {
  try {
    if (!req.user) {
      return next(new ErrorResponse('Authentication required to remove coupon', 401));
    }

    const cart = await Cart.findOne({ user: req.user.id });
    if (!cart) {
      return next(new ErrorResponse('Cart not found', 404));
    }

    cart.coupon = null;
    cart.discount = 0;
    cart.total = cart.subtotal;
    await cart.save();

    return success(res, 'Coupon removed successfully', { cart });
  } catch (err) {
    next(new ErrorResponse(err.message || 'Server error', 500));
  }
};