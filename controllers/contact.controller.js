const Contact = require('../models/contact.model');
const { success } = require('../utils/response.util');
const { ErrorResponse } = require('../middleware/error.middleware');

/**
 * @desc    Submit contact form
 * @route   POST /api/v1/contact
 * @access  Public
 */
exports.submitContactForm = async (req, res, next) => {
  try {
    const { name, email, subject, message } = req.body;

    // Validate input
    if (!name || !email || !message) {
      return next(new ErrorResponse('Please provide name, email and message', 400));
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return next(new ErrorResponse('Please provide a valid email address', 400));
    }

    // Create contact message
    const contact = await Contact.create({
      name,
      email,
      subject: subject || 'General Inquiry',
      message,
      status: 'unread'
    });

    // In a real application, you would send an email notification here
    // For this example, we'll just save to the database

    return success(res, 'Your message has been sent successfully. We will get back to you soon.', { contact });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get all contact messages (admin)
 * @route   GET /api/v1/admin/contact
 * @access  Private/Admin
 */
exports.getContactMessages = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;

    // Build query
    const query = {};

    // Filter by status
    if (status && ['unread', 'read', 'replied'].includes(status)) {
      query.status = status;
    }

    // Pagination
    const skip = (page - 1) * limit;

    // Execute query
    const messages = await Contact.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    // Get total count
    const total = await Contact.countDocuments(query);

    // Calculate pagination info
    const totalPages = Math.ceil(total / limit);
    const hasMore = page < totalPages;

    return success(res, 'Contact messages retrieved successfully', {
      messages,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages,
        hasMore
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get contact message by ID (admin)
 * @route   GET /api/v1/admin/contact/:id
 * @access  Private/Admin
 */
exports.getContactMessage = async (req, res, next) => {
  try {
    const message = await Contact.findById(req.params.id);

    if (!message) {
      return next(new ErrorResponse(`Message not found with id of ${req.params.id}`, 404));
    }

    // Mark as read if unread
    if (message.status === 'unread') {
      message.status = 'read';
      await message.save();
    }

    return success(res, 'Contact message retrieved successfully', { message });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Update contact message status (admin)
 * @route   PUT /api/v1/admin/contact/:id
 * @access  Private/Admin
 */
exports.updateContactMessage = async (req, res, next) => {
  try {
    const { status, adminNotes, reply } = req.body;

    const message = await Contact.findById(req.params.id);

    if (!message) {
      return next(new ErrorResponse(`Message not found with id of ${req.params.id}`, 404));
    }

    // Update fields
    if (status && ['unread', 'read', 'replied'].includes(status)) {
      message.status = status;
    }

    if (adminNotes) {
      message.adminNotes = adminNotes;
    }

    if (reply) {
      message.reply = reply;
      message.repliedAt = Date.now();
      message.repliedBy = req.user.id;
      message.status = 'replied';

      // In a real application, you would send the reply email here
      // For this example, we'll just save to the database
    }

    await message.save();

    return success(res, 'Contact message updated successfully', { message });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Delete contact message (admin)
 * @route   DELETE /api/v1/admin/contact/:id
 * @access  Private/Admin
 */
exports.deleteContactMessage = async (req, res, next) => {
  try {
    const message = await Contact.findById(req.params.id);

    if (!message) {
      return next(new ErrorResponse(`Message not found with id of ${req.params.id}`, 404));
    }

    await message.deleteOne();

    return success(res, 'Contact message deleted successfully', {});
  } catch (err) {
    next(err);
  }
};