const Order = require('../../models/order.model');
const User = require('../../models/user.model');
const { ErrorResponse } = require('../../middleware/error.middleware');
const { success, error, paginate } = require('../../utils/response.util');
const sanitizeHtml = require('sanitize-html');

/**
 * @desc    Get all orders
 * @route   GET /api/v1/admin/orders
 * @access  Private/Admin
 */
exports.getOrders = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;

    const filter = {};

    if (req.query.status && ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'].includes(req.query.status)) {
      filter.status = req.query.status;
    }

    if (req.query.paymentStatus && ['pending', 'paid', 'failed', 'refunded'].includes(req.query.paymentStatus)) {
      filter['paymentInfo.status'] = req.query.paymentStatus;
    }

    if (req.query.startDate && req.query.endDate) {
      const startDate = new Date(req.query.startDate);
      const endDate = new Date(req.query.endDate);
      
      if (startDate && endDate) {
        filter.createdAt = {
          $gte: startDate,
          $lte: new Date(endDate.setHours(23, 59, 59, 999))
        };
      }
    }

    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      
      const users = await User.find({
        $or: [
          { firstName: searchRegex },
          { lastName: searchRegex },
          { email: searchRegex }
        ]
      }).select('_id');
      
      const userIds = users.map(user => user._id);
      
      filter.$or = [
        { orderNumber: searchRegex },
        { user: { $in: userIds } }
      ];
    }

    const total = await Order.countDocuments(filter);
    const orders = await Order.find(filter)
      .populate({
        path: 'user',
        select: 'firstName lastName email',
        options: { lean: true } // Handle null user
      })
      .sort(req.query.sort || '-createdAt')
      .skip(startIndex)
      .limit(limit);

    return paginate(
      res,
      'Orders retrieved successfully',
      orders,
      page,
      limit,
      total
    );
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get single order
 * @route   GET /api/v1/admin/orders/:id
 * @access  Private/Admin
 */
exports.getOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate({
        path: 'user',
        select: 'firstName lastName email phone address',
        options: { lean: true }
      })
      .populate({
        path: 'items.product',
        select: 'name sku images'
      });

    if (!order) {
      return next(new ErrorResponse(`Order not found with id of ${req.params.id}`, 404));
    }

    // Calculate item subtotals
    order.items = order.items.map(item => ({
      ...item._doc,
      subtotal: item.subtotal || item.price * item.quantity
    }));

    return success(res, 'Order retrieved successfully', { order });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Update order status
 * @route   PUT /api/v1/admin/orders/:id/status
 * @access  Private/Admin
 */
exports.updateOrderStatus = async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!status || !['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'].includes(status)) {
      return next(new ErrorResponse('Please provide a valid status', 400));
    }

    let order = await Order.findById(req.params.id);

    if (!order) {
      return next(new ErrorResponse(`Order not found with id of ${req.params.id}`, 404));
    }

    // Capture old status for timeline note if needed, or rely on pre-save hook
    const oldStatus = order.status;

    order.updatedBy = req.user.id;
    order.status = status;

    // The pre-save hook in the Order model handles timeline updates and setting shippedAt/deliveredAt.
    await order.save();

    // Re-fetch and populate for the response to ensure all virtuals and latest data are present
    // Populating 'items.product' with 'images' for consistency with getOrder
    order = await Order.findById(req.params.id)
      .populate({
        path: 'user',
        select: 'firstName lastName email',
        options: { lean: true }
      })
      .populate({
        path: 'items.product',
        select: 'name sku images' // Added 'images' for consistency
      });

    // Recalculate item subtotals for the response
    order.items = order.items.map(item => ({
      ...item._doc,
      subtotal: item.subtotal || item.price * item.quantity
    }));

    return success(res, 'Order status updated successfully', { order });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Add order note
 * @route   POST /api/v1/admin/orders/:id/notes
 * @access  Private/Admin
 */
exports.addOrderNote = async (req, res, next) => {
  try {
    const { content, isInternal = true } = req.body;

    if (!content) {
      return next(new ErrorResponse('Please provide note content', 400));
    }

    const cleanContent = sanitizeHtml(content, { allowedTags: [], allowedAttributes: {} });

    let order = await Order.findById(req.params.id);

    if (!order) {
      return next(new ErrorResponse(`Order not found with id of ${req.params.id}`, 404));
    }

    order.notes.push({
      content: cleanContent,
      isInternal: Boolean(isInternal),
      createdBy: req.user.id
    });

    await order.save();

    order = await Order.findById(req.params.id)
      .populate({
        path: 'user',
        select: 'firstName lastName email',
        options: { lean: true }
      })
      .populate({
        path: 'notes.createdBy',
        select: 'firstName lastName'
      });

    order.items = order.items.map(item => ({
      ...item._doc,
      subtotal: item.subtotal || item.price * item.quantity
    }));

    return success(res, 'Order note added successfully', { order });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Process refund
 * @route   POST /api/v1/admin/orders/:id/refund
 * @access  Private/Admin
 */
exports.processRefund = async (req, res, next) => {
  try {
    const { amount, reason } = req.body;

    if (!amount || !reason) {
      return next(new ErrorResponse('Please provide refund amount and reason', 400));
    }

    const cleanReason = sanitizeHtml(reason, { allowedTags: [], allowedAttributes: {} });
    const refundAmountInKobo = parseFloat(amount) * 100; // Convert to kobo for Paystack

    let order = await Order.findById(req.params.id);

    if (!order) {
      return next(new ErrorResponse(`Order not found with id of ${req.params.id}`, 404));
    }

    if (order.paymentInfo.status !== 'paid') {
      return next(new ErrorResponse('Cannot refund an order that has not been paid', 400));
    }

    if (parseFloat(amount) <= 0 || parseFloat(amount) > order.totalAmount) {
      return next(new ErrorResponse('Invalid refund amount', 400));
    }

    // Process the refund
    let refundProcessed = false;
    let refundError = null;
    let refundReference = null;
    
    try {
      // Check if we have a transaction ID and Paystack is configured
      if (order.paymentInfo.transactionId && process.env.PAYSTACK_SECRET_KEY) {
        // Use the Paystack utility for processing refunds
        const paystackUtil = require('../../utils/paystack.util');
        
        try {
          const refundResponse = await paystackUtil.processRefund(
            order.paymentInfo.transactionId,
            refundAmountInKobo, // Pass amount in kobo
            cleanReason
          );
          
          if (refundResponse.status) {
            refundProcessed = true;
            refundReference = refundResponse.data?.reference || 'N/A';
          } else {
            refundError = refundResponse.message || 'Paystack refund failed';
          }
        } catch (paystackError) {
          console.error('Paystack refund error:', paystackError);
          refundError = paystackError.message;
        }
      } else {
        // Manual refund process (no payment gateway integration)
        refundProcessed = true;
        refundReference = `MANUAL-${Date.now()}`;
      }
    } catch (refundErr) {
      console.error('Refund processing error:', refundErr);
      refundError = refundErr.message;
      refundProcessed = false;
    }
    
    if (!refundProcessed) {
      return next(new ErrorResponse(`Refund failed: ${refundError || 'Unknown error'}`, 400));
    }
    
    // Store refund reference in payment info
    order.paymentInfo.refundReference = refundReference;

    // Update order status and payment info
    order.paymentInfo.status = 'refunded';
    order.status = 'refunded';
    order.updatedBy = req.user.id;

    // Add refund details to order notes
    order.notes.push({
      content: `Refund processed: ${parseFloat(amount).toFixed(2)} - Reason: ${cleanReason} (Ref: ${refundReference})`,
      isInternal: true,
      createdBy: req.user.id
    });

    // Add to timeline
    order.timeline.push({
      status: 'refunded',
      note: `Refund processed: ${parseFloat(amount).toFixed(2)} - Reason: ${cleanReason}`,
      updatedBy: req.user.id
    });

    await order.save();

    // Send refund confirmation email if customer has email
    if (order.user?.email) {
      try {
        const { sendEmail } = require('../../utils/email.util');
        await sendEmail({
          to: order.user.email,
          subject: `Refund Processed for Order ${order.orderNumber}`,
          text: `Dear ${order.user.firstName || 'Customer'},\n\nWe have processed a refund of ₦${parseFloat(amount).toFixed(2)} for your order ${order.orderNumber}.\n\nReason: ${cleanReason}\n\nThe refund should appear in your account within 5-10 business days, depending on your payment provider.\n\nIf you have any questions, please contact our customer service.\n\nThank you for shopping with Scenture Lagos!`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #333;">Refund Processed</h2>
              <p>Dear ${order.user.firstName || 'Customer'},</p>
              <p>We have processed a refund for your order.</p>
              
              <div style="background-color: #f7f7f7; padding: 15px; margin: 20px 0;">
                <p><strong>Order Number:</strong> ${order.orderNumber}</p>
                <p><strong>Refund Amount:</strong> ₦${parseFloat(amount).toFixed(2)}</p>
                <p><strong>Reason:</strong> ${cleanReason}</p>
                <p><strong>Refund Reference:</strong> ${refundReference}</p>
              </div>
              
              <p>The refund should appear in your account within 5-10 business days, depending on your payment provider.</p>
              <p>If you have any questions, please contact our customer service.</p>
              <p>Thank you for shopping with Scenture Lagos!</p>
            </div>
          `
        });
        
        // Add note about email
        order.notes.push({
          content: `Refund confirmation email sent to ${order.user.email}`,
          isInternal: true,
          createdBy: req.user.id
        });
        
        await order.save();
      } catch (emailErr) {
        console.error('Failed to send refund email:', emailErr);
        // Don't fail the whole operation if email fails
        order.notes.push({
          content: `Failed to send refund email to ${order.user.email}: ${emailErr.message}`,
          isInternal: true,
          createdBy: req.user.id
        });
        await order.save(); // Save the note about email failure
      }
    }

    // Get updated order with populated fields for the response
    order = await Order.findById(req.params.id)
      .populate({
        path: 'user',
        select: 'firstName lastName email',
        options: { lean: true }
      })
      .populate({
        path: 'notes.createdBy',
        select: 'firstName lastName'
      })
      .populate({
        path: 'items.product', // Populate product details for items
        select: 'name sku images'
      });

    order.items = order.items.map(item => ({
      ...item._doc,
      subtotal: item.subtotal || item.price * item.quantity
    }));

    return success(res, 'Refund processed successfully', { order });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Send order email to customer
 * @route   POST /api/v1/admin/orders/:id/email
 * @access  Private/Admin
 */
exports.sendOrderEmail = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate({
        path: 'user',
        select: 'firstName lastName email',
        options: { lean: true }
      });

    if (!order) {
      return next(new ErrorResponse(`Order not found with id of ${req.params.id}`, 404));
    }

    if (!order.user?.email) {
      return next(new ErrorResponse('No customer email found for this order', 400));
    }

    // Import email utility
    const { sendOrderConfirmationEmail } = require('../../utils/email.util');
    
    try {
      // Send the email
      await sendOrderConfirmationEmail(order, order.user.email);
      
      // Add a note to the order
      order.notes.push({
        content: `Order confirmation email sent to ${order.user?.email || 'N/A'}`,
        isInternal: true,
        createdBy: req.user.id
      });

      await order.save();

      return success(res, 'Email sent successfully', { order });
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      
      // Still add a note about the attempt
      order.notes.push({
        content: `Failed to send order confirmation email to ${order.user?.email || 'N/A'}: ${emailError.message}`,
        isInternal: true,
        createdBy: req.user.id
      });

      await order.save();
      
      return next(new ErrorResponse(`Failed to send email: ${emailError.message}`, 500));
    }
  } catch (err) {
    next(err);
  }
};