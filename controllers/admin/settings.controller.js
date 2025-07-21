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

    if (req.body.storeName) fieldsToUpdate.storeName = req.body.storeName;
    if (req.body.storeEmail) fieldsToUpdate.storeEmail = req.body.storeEmail;
    if (req.body.storePhone) fieldsToUpdate.storePhone = req.body.storePhone;
    if (req.body.lowStockThreshold !== undefined) fieldsToUpdate.lowStockThreshold = req.body.lowStockThreshold;
    if (req.body.socialMedia) fieldsToUpdate.socialMedia = { ...settings.socialMedia, ...req.body.socialMedia };
    if (req.body.currency) fieldsToUpdate.currency = { ...settings.currency, ...req.body.currency };
    if (req.body.tax) fieldsToUpdate.tax = { ...settings.tax, ...req.body.tax };
    if (req.body.emailNotifications) fieldsToUpdate.emailNotifications = { ...settings.emailNotifications, ...req.body.emailNotifications };
    if (req.body.shipping) fieldsToUpdate.shipping = { ...settings.shipping, ...req.body.shipping };

    settings = await Settings.findByIdAndUpdate(
      settings._id,
      { ...fieldsToUpdate, updatedBy: req.user?.id, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );
    return success(res, 'Settings updated successfully', { settings });
  } catch (err) {
    next(err);
  }
};

/**
  * @desc     Add a NEW shipping zone
  * @route    POST /api/v1/admin/settings/shipping-zones
  * @access   Private/Admin
*/
exports.addShippingZone = async (req, res, next) => {
    try {
        const { name, regions, active } = req.body;

        if (!name) return next(new ErrorResponse('Please provide a name for the shipping zone', 400));
        if (!regions || !Array.isArray(regions) || regions.length === 0) {
            return next(new ErrorResponse('Please provide at least one region (e.g., a state)', 400));
        }

        const settings = await Settings.getSettings();

        // NOTE: We no longer add rates here. We just create the zone itself.
        const newShippingZone = {
            name,
            regions,
            active: active !== undefined ? active : true,
            shippingRates: [] // It starts with an empty array of rates
        };

        settings.shipping.zones.push(newShippingZone);
        await settings.save();

        const createdZone = settings.shipping.zones[settings.shipping.zones.length - 1];

        return success(res, 'Shipping zone added successfully. You can now add shipping rates to this zone.', { shippingZone: createdZone, settings });
    } catch (err) {
        next(err);
    }
};

/**
  * @desc     Update a shipping zone's details (name, regions)
  * @route    PUT /api/v1/admin/settings/shipping-zones/:id
  * @access   Private/Admin
*/
exports.updateShippingZone = async (req, res, next) => {
    try {
        const { name, regions, active } = req.body;
        const settings = await Settings.getSettings();
        const shippingZone = settings.shipping.zones.id(req.params.id);

        if (!shippingZone) {
            return next(new ErrorResponse(`Shipping zone not found with id of ${req.params.id}`, 404));
        }

        // We only update the zone's own properties here
        if (name) shippingZone.name = name;
        if (regions) shippingZone.regions = regions;
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
 * @desc    Add a shipping rate to a specific zone
 * @route   POST /api/v1/admin/settings/shipping-zones/:zoneId/rates
 * @access  Private/Admin
 */
exports.addRateToZone = async (req, res, next) => {
  try {
    const { name, price, description, freeShippingThreshold, active } = req.body;
    const { zoneId } = req.params;

    if (!name || price === undefined) {
      return next(new ErrorResponse('Please provide a name and price for the rate', 400));
    }

    const settings = await Settings.getSettings();
    const zone = settings.shipping.zones.id(zoneId);

    if (!zone) {
      return next(new ErrorResponse(`Shipping zone not found with id of ${zoneId}`, 404));
    }

    const newRate = { name, price, description, freeShippingThreshold, active };
    zone.shippingRates.push(newRate);
    await settings.save();

    // Return the newly created subdocument
    const createdRate = zone.shippingRates[zone.shippingRates.length - 1];
    return success(res, 'Shipping rate added successfully', { rate: createdRate, settings });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Update a specific shipping rate within a zone
 * @route   PUT /api/v1/admin/settings/shipping-zones/:zoneId/rates/:rateId
 * @access  Private/Admin
 */
exports.updateRateInZone = async (req, res, next) => {
  try {
    const { zoneId, rateId } = req.params;
    const settings = await Settings.getSettings();
    const zone = settings.shipping.zones.id(zoneId);

    if (!zone) {
      return next(new ErrorResponse(`Shipping zone not found with id of ${zoneId}`, 404));
    }

    const rate = zone.shippingRates.id(rateId);
    if (!rate) {
      return next(new ErrorResponse(`Shipping rate not found with id of ${rateId}`, 404));
    }

    // Update fields from req.body
    rate.set(req.body);
    await settings.save();
    
    return success(res, 'Shipping rate updated successfully', { rate, settings });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Delete a specific shipping rate from a zone
 * @route   DELETE /api/v1/admin/settings/shipping-zones/:zoneId/rates/:rateId
 * @access  Private/Admin
 */
exports.deleteRateFromZone = async (req, res, next) => {
  try {
    const { zoneId, rateId } = req.params;
    const settings = await Settings.getSettings();
    const zone = settings.shipping.zones.id(zoneId);

    if (!zone) {
      return next(new ErrorResponse(`Shipping zone not found with id of ${zoneId}`, 404));
    }

    const rate = zone.shippingRates.id(rateId);
    if (!rate) {
        return next(new ErrorResponse(`Shipping rate not found with id of ${rateId}`, 404));
    }

    rate.remove();
    await settings.save();

    return success(res, 'Shipping rate deleted successfully', { settings });
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