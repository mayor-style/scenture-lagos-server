/**
 * Utility for validating request data
 */

/**
 * Validate email format
 * @param {String} email - Email to validate
 * @returns {Boolean} - True if valid, false otherwise
 */
exports.isValidEmail = (email) => {
  const emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
  return emailRegex.test(email);
};

/**
 * Validate password strength
 * @param {String} password - Password to validate
 * @returns {Object} - Validation result with isValid flag and message
 */
exports.validatePassword = (password) => {
  if (!password || password.length < 6) {
    return {
      isValid: false,
      message: 'Password must be at least 6 characters long'
    };
  }

  // Check for at least one uppercase letter, one lowercase letter, and one number
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);

  if (!hasUppercase || !hasLowercase || !hasNumber) {
    return {
      isValid: false,
      message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number'
    };
  }

  return {
    isValid: true,
    message: 'Password is valid'
  };
};

/**
 * Validate phone number format
 * @param {String} phone - Phone number to validate
 * @returns {Boolean} - True if valid, false otherwise
 */
exports.isValidPhone = (phone) => {
  // Basic phone validation - can be adjusted for specific country formats
  const phoneRegex = /^\+?[0-9]{10,15}$/;
  return phoneRegex.test(phone);
};

/**
 * Sanitize object by removing specified fields
 * @param {Object} obj - Object to sanitize
 * @param {Array} fieldsToRemove - Fields to remove from object
 * @returns {Object} - Sanitized object
 */
exports.sanitizeObject = (obj, fieldsToRemove = []) => {
  const sanitized = { ...obj };
  fieldsToRemove.forEach(field => {
    delete sanitized[field];
  });
  return sanitized;
};

/**
 * Check if object has required fields
 * @param {Object} obj - Object to check
 * @param {Array} requiredFields - Required field names
 * @returns {Object} - Validation result with isValid flag and missing fields
 */
exports.hasRequiredFields = (obj, requiredFields = []) => {
  const missingFields = [];

  requiredFields.forEach(field => {
    if (obj[field] === undefined || obj[field] === null || obj[field] === '') {
      missingFields.push(field);
    }
  });

  return {
    isValid: missingFields.length === 0,
    missingFields
  };
};

/**
 * Validate number is within range
 * @param {Number} value - Number to validate
 * @param {Number} min - Minimum value (inclusive)
 * @param {Number} max - Maximum value (inclusive)
 * @returns {Boolean} - True if valid, false otherwise
 */
exports.isNumberInRange = (value, min, max) => {
  const num = Number(value);
  return !isNaN(num) && num >= min && num <= max;
};