/**
 * @fileoverview Utility functions related to product logic, especially stock status.
 */

/**
 * @desc Helper function to calculate the stock status of a product.
 * This function is designed to be reusable across different controllers (e.g., products, inventory).
 * It determines the status based on the product's main stock or the sum of its variant stocks.
 *
 * @param {Object} product - The product object from the database (should be a lean object).
 * @param {number} lowStockThreshold - The configured low stock threshold from settings.
 * @returns {string} The stock status ('in_stock', 'low_stock', 'out_of_stock').
 */
const calculateProductStatus = (product, lowStockThreshold) => {
    const hasVariants = product.variants && product.variants.length > 0;
    let effectiveStock = 0;

    if (hasVariants) {
        // If product has variants, sum stock of all variants to get effective stock
        effectiveStock = product.variants.reduce((sum, v) => sum + (v.stockQuantity || 0), 0);
    } else {
        // If no variants, use the main product's stock quantity
        effectiveStock = product.stockQuantity || 0;
    }

    if (effectiveStock <= 0) {
        return 'out_of_stock';
    } else if (effectiveStock > 0 && effectiveStock <= lowStockThreshold) {
        return 'low_stock';
    } else {
        return 'in_stock';
    }
};

module.exports = {
    calculateProductStatus,
};