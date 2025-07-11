const Settings = require('../../models/settings.model');
const { ErrorResponse } = require('../../middleware/error.middleware');
const { success } = require('../../utils/response.util');

/**
 * @desc    Get current settings
 * @route   GET /api/v1/admin/settings
 * @access  Private/Admin
 */
exports.getSettings = async (req, res, next) => {
  try {
    const settings = await Settings.getSettings();
    return success(res, 'Settings retrieved successfully', { settings });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Update settings
 * @route   PUT /api/v1/admin/settings
 * @access  Private/Admin
 */
exports.updateSettings = async (req, res, next) => {
  try {
    let settings = await Settings.getSettings();
    const fieldsToUpdate = {};

    // Direct fields
    if (req.body.storeName) fieldsToUpdate.storeName = req.body.storeName;
    if (req.body.storeEmail) fieldsToUpdate.storeEmail = req.body.storeEmail;
    if (req.body.storePhone) fieldsToUpdate.storePhone = req.body.storePhone;
    if (req.body.lowStockThreshold !== undefined) fieldsToUpdate.lowStockThreshold = req.body.lowStockThreshold;
    if (req.body.orderPrefix) fieldsToUpdate.orderPrefix = req.body.orderPrefix;
    if (req.body.invoicePrefix) fieldsToUpdate.invoicePrefix = req.body.invoicePrefix;

    // Nested fields
    if (req.body.socialMedia) {
      fieldsToUpdate.socialMedia = { ...settings.socialMedia, ...req.body.socialMedia };
    }
    if (req.body.currency) {
      fieldsToUpdate.currency = { ...settings.currency, ...req.body.currency };
    }
    if (req.body.tax) {
      fieldsToUpdate.tax = { ...settings.tax, ...req.body.tax };
    }
    if (req.body.emailNotifications) {
      fieldsToUpdate.emailNotifications = { ...settings.emailNotifications, ...req.body.emailNotifications };
    }
    if (req.body.shipping) {
      fieldsToUpdate.shipping = { ...settings.shipping, ...req.body.shipping };
    }
    if (req.body.payment) {
      fieldsToUpdate.payment = { ...settings.payment, ...req.body.payment };
    }

    settings = await Settings.findByIdAndUpdate(
      settings._id,
      { ...fieldsToUpdate, updatedBy: req.user.id, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );

    return success(res, 'Settings updated successfully', { settings });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Add shipping zone
 * @route   POST /api/v1/admin/settings/shipping-zones
 * @access  Private/Admin
 */
exports.addShippingZone = async (req, res, next) => {
  try {
    const { name, regions, rate, freeShippingThreshold, active } = req.body;

    if (!name) return next(new ErrorResponse('Please provide a name for the shipping zone', 400));
    if (!regions || !Array.isArray(regions) || regions.length === 0) {
      return next(new ErrorResponse('Please provide at least one region for the shipping zone', 400));
    }
    if (rate === undefined) return next(new ErrorResponse('Please provide a shipping rate', 400));

    const settings = await Settings.getSettings();
    const newShippingZone = { name, regions, rate, freeShippingThreshold, active };
    settings.shipping.zones.push(newShippingZone);
    await settings.save();

    return success(res, 'Shipping zone added successfully', { shippingZone: newShippingZone, settings });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Update shipping zone
 * @route   PUT /api/v1/admin/settings/shipping-zones/:id
 * @access  Private/Admin
 */
exports.updateShippingZone = async (req, res, next) => {
  try {
    const { name, regions, rate, freeShippingThreshold, active } = req.body;
    const settings = await Settings.getSettings();
    const shippingZone = settings.shipping.zones.id(req.params.id);

    if (!shippingZone) {
      return next(new ErrorResponse(`Shipping zone not found with id of ${req.params.id}`, 404));
    }

    if (name) shippingZone.name = name;
    if (regions) shippingZone.regions = regions;
    if (rate !== undefined) shippingZone.rate = rate;
    if (freeShippingThreshold !== undefined) shippingZone.freeShippingThreshold = freeShippingThreshold;
    if (active !== undefined) shippingZone.active = active;

    await settings.save();

    return success(res, 'Shipping zone updated successfully', { shippingZone, settings });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Delete shipping zone
 * @route   DELETE /api/v1/admin/settings/shipping-zones/:id
 * @access  Private/Admin
 */
exports.deleteShippingZone = async (req, res, next) => {
  try {
    const settings = await Settings.getSettings();
    const shippingZone = settings.shipping.zones.id(req.params.id);

    if (!shippingZone) {
      return next(new ErrorResponse(`Shipping zone not found with id of ${req.params.id}`, 404));
    }

    shippingZone.remove();
    await settings.save();

    return success(res, 'Shipping zone deleted successfully', { settings });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Add payment method
 * @route   POST /api/v1/admin/settings/payment-methods
 * @access  Private/Admin
 */
exports.addPaymentMethod = async (req, res, next) => {
  try {
    const { name, displayName, description, active, config } = req.body;

    if (!name || !displayName) {
      return next(new ErrorResponse('Please provide name and displayName for the payment method', 400));
    }

    const settings = await Settings.getSettings();
    const newPaymentMethod = { name, displayName, description: description || '', active: active !== undefined ? active : true, config: config || {} };
    settings.payment.methods.push(newPaymentMethod);
    await settings.save();

    return success(res, 'Payment method added successfully', { paymentMethod: newPaymentMethod, settings });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Update payment method
 * @route   PUT /api/v1/admin/settings/payment-methods/:id
 * @access  Private/Admin
 */
exports.updatePaymentMethod = async (req, res, next) => {
  try {
    const { name, displayName, description, active, config } = req.body;
    const settings = await Settings.getSettings();
    const paymentMethod = settings.payment.methods.id(req.params.id);

    if (!paymentMethod) {
      return next(new ErrorResponse(`Payment method not found with id of ${req.params.id}`, 404));
    }

    if (name) paymentMethod.name = name;
    if (displayName) paymentMethod.displayName = displayName;
    if (description !== undefined) paymentMethod.description = description;
    if (active !== undefined) paymentMethod.active = active;
    if (config) paymentMethod.config = { ...paymentMethod.config, ...config };

    await settings.save();

    return success(res, 'Payment method updated successfully', { paymentMethod, settings });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Delete payment method
 * @route   DELETE /api/v1/admin/settings/payment-methods/:id
 * @access  Private/Admin
 */
exports.deletePaymentMethod = async (req, res, next) => {
  try {
    const settings = await Settings.getSettings();
    const paymentMethod = settings.payment.methods.id(req.params.id);

    if (!paymentMethod) {
      return next(new ErrorResponse(`Payment method not found with id of ${req.params.id}`, 404));
    }

    paymentMethod.remove();
    await settings.save();

    return success(res, 'Payment method deleted successfully', { settings });
  } catch (err) {
    next(err);
  }
};