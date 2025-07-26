const mongoose = require('mongoose');
const Product = require('../models/product.model');
const Cart = require('../models/cart.model');
const Category = require('../models/category.model');
const { ErrorResponse } = require('../middleware/error.middleware');
const { success } = require('../utils/response.util');

/**
 * @desc    Helper function to recalculate all cart totals.
 * This also applies any existing coupon discount.
 * @param   {object} cart - The cart object to recalculate.
 */
const recalculateCart = (cart) => {
  cart.subtotal = cart.items.reduce((sum, item) => sum + item.total, 0);
  cart.totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0);

  if (cart.coupon && cart.coupon.code) {
    // Re-apply discount based on the new subtotal
    cart.discount = (cart.subtotal * cart.coupon.discount) / 100;
  } else {
    cart.discount = 0;
  }

  cart.total = cart.subtotal - cart.discount;
};

/**
 * @desc    Add item to cart
 * @route   POST /api/v1/cart
 * @access  Public
 */
exports.addToCart = async (req, res, next) => {
  try {
    const { productId, quantity, variantId } = req.body;

    // Validate input
    if (!productId || !quantity || quantity <= 0) {
      return next(new ErrorResponse('Please provide a valid product ID and quantity', 400));
    }

    // Find product and populate its category in one go
    const product = await Product.findById(productId).populate('category', 'name').lean();
    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${productId}`, 404));
    }
    if (product.status !== 'published') {
      return next(new ErrorResponse('This product is currently unavailable', 400));
    }

    // Initialize or find cart
    let cart;
    if (req.user) {
      cart = await Cart.findOne({ user: req.user.id });
      if (!cart) {
        cart = new Cart({ user: req.user.id, items: [] });
      }
    } else {
      // For guests, use the session cart or create a new one
      req.session.cart = req.session.cart || { items: [], totalItems: 0, subtotal: 0, discount: 0, total: 0, coupon: null };
      cart = req.session.cart;
    }

    // Determine price, stock, SKU, and other details from product/variant
    let itemPrice = product.price;
    let itemStock = product.stockQuantity;
    let itemSku = product.sku;
    let variantInfo = null;
    const itemCategory = product.category?.name || 'Uncategorized';

    if (variantId) {
      const variant = product.variants?.find((v) => v._id.toString() === variantId);
      if (!variant) {
        return next(new ErrorResponse(`Variant not found with id of ${variantId}`, 404));
      }
      itemPrice = product.price + (variant.priceAdjustment || 0);
      itemStock = variant.stockQuantity;
      itemSku = variant.sku;
      variantInfo = {
        _id: variant._id,
        size: variant.size,
        scentIntensity: variant.scentIntensity,
        sku: variant.sku,
        priceAdjustment: variant.priceAdjustment,
      };
    }

    // Check stock before proceeding
    if (quantity > itemStock) {
      return next(new ErrorResponse(`Not enough stock. Only ${itemStock} items available.`, 400));
    }

    // Check if the exact item (product + variant combination) already exists in the cart
    const cartItemIndex = cart.items.findIndex(
      (item) =>
        item.product.toString() === productId &&
        (variantId ? item.variant?._id.toString() === variantId : !item.variant)
    );

    if (cartItemIndex > -1) {
      // Item exists, so update its quantity
      const existingItem = cart.items[cartItemIndex];
      const updatedQuantity = existingItem.quantity + quantity;

      if (updatedQuantity > itemStock) {
        return next(
          new ErrorResponse(
            `Cannot add ${quantity} more. Total quantity would exceed available stock of ${itemStock}.`,
            400
          )
        );
      }
      existingItem.quantity = updatedQuantity;
      existingItem.total = updatedQuantity * itemPrice;
    } else {
      // Item does not exist, add it as a new item
      cart.items.push({
        _id: new mongoose.Types.ObjectId(), // Use a consistent ID format for all items
        product: productId,
        productName: product.name,
        productSlug: product.slug,
        productImage: product.images.find((img) => img.isMain)?.url || product.images[0]?.url || null,
        category: itemCategory,
        variant: variantInfo,
        sku: itemSku,
        price: itemPrice,
        quantity,
        total: quantity * itemPrice,
      });
    }

    // Use the centralized function to update all cart totals
    recalculateCart(cart);

    if (req.user) {
      // Mongoose's pre-save hook will also run, providing a double-check
      await cart.save();
    } else {
      req.session.cart = cart;
    }

   return success(res, 'Item added to cart', { cart }, 201);
  } catch (err) {
    next(new ErrorResponse(err.message || 'Server error', 500));
  }
};

/**
 * @desc    Get cart and validate its contents
 * @route   GET /api/v1/cart
 * @access  Public
 */
exports.getCart = async (req, res, next) => {
  try {
    let cart;
    const emptyCart = { items: [], totalItems: 0, subtotal: 0, discount: 0, total: 0, coupon: null };

    if (req.user) {
      cart = await Cart.findOne({ user: req.user.id });
      if (!cart) {
        return success(res, 'Cart retrieved successfully', { cart: emptyCart });
      }
    } else {
      cart = req.session.cart || emptyCart;
      if (!cart.items || cart.items.length === 0) {
        return success(res, 'Cart retrieved successfully', { cart });
      }
    }

    let cartWasModified = false;
    const productIds = [...new Set(cart.items.map(item => item.product.toString()))];
    const products = await Product.find({ _id: { $in: productIds } }).lean();
    const productMap = new Map(products.map(p => [p._id.toString(), p]));

    // Validate each item in the cart against the live product data
    for (const item of cart.items) {
      const product = productMap.get(item.product.toString());
      item.isAvailable = false; // Default to not available

      if (product && product.status === 'published') {
        let livePrice = product.price;
        let liveStock = product.stockQuantity;
        let variantExists = true;

        if (item.variant?._id) {
          const variant = product.variants.find(v => v._id.toString() === item.variant._id.toString());
          if (variant) {
            livePrice += variant.priceAdjustment || 0;
            liveStock = variant.stockQuantity;
          } else {
            variantExists = false; // Variant was deleted
          }
        }

        if (variantExists) {
          item.isAvailable = true;
          item.availableStock = liveStock;
          item.hasPriceChanged = item.price !== livePrice;
          
          if (item.hasPriceChanged) {
            cartWasModified = true;
            item.oldPrice = item.price;
            item.price = livePrice;
            item.total = item.quantity * livePrice;
          }

          if (item.quantity > liveStock) {
            cartWasModified = true;
            item.quantity = liveStock; // Adjust quantity to max available
            item.total = item.quantity * livePrice;
          }
        }
      }

      // If item became unavailable (product deleted, archived, or variant removed)
      if (!item.isAvailable) {
        cartWasModified = true;
        // Mark for removal instead of splicing inside loop
        item.quantity = 0; 
      }
    }

    if (cartWasModified) {
      // Filter out items that are now unavailable
      cart.items = cart.items.filter(item => item.isAvailable && item.quantity > 0);
      recalculateCart(cart); // Recalculate totals after validation
      
      if (req.user) {
        await cart.save();
      } else {
        req.session.cart = cart;
      }
    }

    return success(res, 'Cart retrieved successfully', { cart });
  } catch (err) {
    next(new ErrorResponse(err.message || 'Server error', 500));
  }
};

/**
 * @desc    Update cart item quantity
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
      cart = req.session.cart;
      if (!cart) {
        return next(new ErrorResponse('Cart not found', 404));
      }
    }

    const itemIndex = cart.items.findIndex((item) => item._id.toString() === itemId);
    if (itemIndex === -1) {
      return next(new ErrorResponse(`Item not found in cart with id of ${itemId}`, 404));
    }

    const cartItem = cart.items[itemIndex];
    const product = await Product.findById(cartItem.product).lean();
    if (!product || product.status !== 'published') {
      // If product is gone, remove item from cart
      cart.items.splice(itemIndex, 1);
      recalculateCart(cart);
      if (req.user) await cart.save();
      return next(new ErrorResponse('This product is no longer available and has been removed from your cart.', 404));
    }

    let itemStock = product.stockQuantity;
    if (cartItem.variant?._id) {
      const variant = product.variants?.find((v) => v._id.toString() === cartItem.variant._id.toString());
      if (!variant) {
        cart.items.splice(itemIndex, 1);
        recalculateCart(cart);
        if (req.user) await cart.save();
        return next(new ErrorResponse('This product variant is no longer available and has been removed.', 404));
      }
      itemStock = variant.stockQuantity;
    }

    if (quantity > itemStock) {
      return next(new ErrorResponse(`Not enough stock. Only ${itemStock} items available.`, 400));
    }

    cart.items[itemIndex].quantity = quantity;
    cart.items[itemIndex].total = quantity * cartItem.price;
    recalculateCart(cart);

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
    } else {
      cart = req.session.cart;
    }
    if (!cart) {
      return next(new ErrorResponse('Cart not found', 404));
    }
    
    const initialItemCount = cart.items.length;
    cart.items = cart.items.filter((item) => item._id.toString() !== itemId);

    if (cart.items.length === initialItemCount) {
        return next(new ErrorResponse(`Item not found in cart with id of ${itemId}`, 404));
    }

    recalculateCart(cart);

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
    if (req.user) {
      await Cart.findOneAndRemove({ user: req.user.id });
    }
    // Clear session cart for both guests and logged-in users
    req.session.cart = null;

    const emptyCart = { items: [], totalItems: 0, subtotal: 0, discount: 0, total: 0, coupon: null };
    return success(res, 'Cart cleared successfully', { cart: emptyCart });
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
      return next(new ErrorResponse('You must be logged in to apply a coupon', 401));
    }

    const cart = await Cart.findOne({ user: req.user.id });
    if (!cart || cart.items.length === 0) {
      return next(new ErrorResponse('Your cart is empty', 404));
    }

    // --- Recommended: Replace this mock logic with a database lookup for a Coupon model ---
    if (code.toUpperCase() !== 'SAVE10') {
      return next(new ErrorResponse('Invalid or expired coupon code', 400));
    }
    const discountPercentage = 10;
    // --- End of mock logic ---

    cart.coupon = { code: code.toUpperCase(), discount: discountPercentage };
    recalculateCart(cart); // Let the helper function handle the math

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
      return next(new ErrorResponse('Authentication required', 401));
    }

    const cart = await Cart.findOne({ user: req.user.id });
    if (!cart) {
      return next(new ErrorResponse('Cart not found', 404));
    }

    cart.coupon = undefined; // Use undefined to remove the field
    cart.discount = 0;
    recalculateCart(cart); // Recalculate total without discount

    await cart.save();
    return success(res, 'Coupon removed successfully', { cart });
  } catch (err) {
    next(new ErrorResponse(err.message || 'Server error', 500));
  }
};