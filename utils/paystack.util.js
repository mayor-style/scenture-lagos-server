const axios = require('axios');

/**
 * Paystack API utility for payment operations
 */
const paystackUtil = {
  /**
   * Initialize the Paystack API with configuration
   * @returns {Object} Configured axios instance for Paystack API
   */
  getPaystackAPI: () => {
    const paystackAPI = axios.create({
      baseURL: 'https://api.paystack.co',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    return paystackAPI;
  },

  /**
   * Initialize a payment transaction
   * @param {Object} paymentData - Payment data including amount, email, etc.
   * @returns {Promise<Object>} Transaction initialization response
   */
  initializeTransaction: async (paymentData) => {
    try {
      const paystackAPI = paystackUtil.getPaystackAPI();
      const response = await paystackAPI.post('/transaction/initialize', {
        amount: paymentData.amount * 100, // Convert to kobo (Paystack uses the smallest currency unit)
        email: paymentData.email,
        reference: paymentData.reference,
        callback_url: paymentData.callbackUrl,
        metadata: paymentData.metadata || {}
      });
      
      return response.data;
    } catch (error) {
      console.error('Paystack transaction initialization error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to initialize payment');
    }
  },

  /**
   * Verify a payment transaction
   * @param {string} reference - Transaction reference
   * @returns {Promise<Object>} Transaction verification response
   */
  verifyTransaction: async (reference) => {
    try {
      const paystackAPI = paystackUtil.getPaystackAPI();
      const response = await paystackAPI.get(`/transaction/verify/${reference}`);
      
      return response.data;
    } catch (error) {
      console.error('Paystack transaction verification error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to verify payment');
    }
  },

  /**
   * Process a refund for a transaction
   * @param {string} transactionId - Transaction ID or reference
   * @param {number} amount - Amount to refund (in the smallest currency unit)
   * @param {string} reason - Reason for the refund
   * @returns {Promise<Object>} Refund response
   */
  processRefund: async (transactionId, amount, reason) => {
    try {
      const paystackAPI = paystackUtil.getPaystackAPI();
      const response = await paystackAPI.post('/refund', {
        transaction: transactionId,
        amount: amount * 100, // Convert to kobo (Paystack uses the smallest currency unit)
        reason: reason
      });
      
      return response.data;
    } catch (error) {
      console.error('Paystack refund error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to process refund');
    }
  },

  /**
   * Get transaction details
   * @param {string} transactionId - Transaction ID
   * @returns {Promise<Object>} Transaction details
   */
  getTransaction: async (transactionId) => {
    try {
      const paystackAPI = paystackUtil.getPaystackAPI();
      const response = await paystackAPI.get(`/transaction/${transactionId}`);
      
      return response.data;
    } catch (error) {
      console.error('Paystack get transaction error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to get transaction details');
    }
  }
};

module.exports = paystackUtil;