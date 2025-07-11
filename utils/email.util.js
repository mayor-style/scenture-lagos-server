/**
 * Email utility for sending emails using Nodemailer
 */
const nodemailer = require('nodemailer');

/**
 * Create a transporter for sending emails
 * @returns {Object} Nodemailer transporter
 */
const createTransporter = () => {
  // For development, use a test account
  if (process.env.NODE_ENV !== 'production') {
    return nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.ethereal.email',
      port: process.env.EMAIL_PORT || 587,
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });
  }

  // For production, use SendGrid
  return nodemailer.createTransport({
    service: 'SendGrid',
    auth: {
      user: 'apikey',
      pass: process.env.SENDGRID_API_KEY
    }
  });
};

/**
 * Send an email
 * @param {Object} options - Email options
 * @param {String} options.to - Recipient email
 * @param {String} options.subject - Email subject
 * @param {String} options.text - Plain text content
 * @param {String} options.html - HTML content
 * @returns {Promise<Object>} Email send info
 */
exports.sendEmail = async (options) => {
  const transporter = createTransporter();

  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@scenture.com',
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html
  };

  return await transporter.sendMail(mailOptions);
};

/**
 * Send an order confirmation email
 * @param {Object} order - Order object
 * @param {String} customerEmail - Customer email
 * @returns {Promise<Object>} Email send info
 */
exports.sendOrderConfirmationEmail = async (order, customerEmail) => {
  const subject = `Order Confirmation - ${order.orderNumber}`;
  
  // Create plain text version
  const text = `
    Dear ${order.user?.firstName || 'Customer'},

    Thank you for your order with Scenture Lagos!

    Order Number: ${order.orderNumber}
    Order Date: ${new Date(order.createdAt).toLocaleDateString()}
    Order Status: ${order.status}
    Order Total: ${order.totalAmount}

    We'll notify you when your order has been shipped.

    Thank you for shopping with Scenture Lagos!
  `;

  // Create HTML version
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Thank you for your order!</h2>
      <p>Dear ${order.user?.firstName || 'Customer'},</p>
      <p>We're pleased to confirm your order with Scenture Lagos.</p>
      
      <div style="background-color: #f7f7f7; padding: 15px; margin: 20px 0;">
        <p><strong>Order Number:</strong> ${order.orderNumber}</p>
        <p><strong>Order Date:</strong> ${new Date(order.createdAt).toLocaleDateString()}</p>
        <p><strong>Order Status:</strong> ${order.status}</p>
        <p><strong>Order Total:</strong> ₦${order.totalAmount.toFixed(2)}</p>
      </div>
      
      <h3 style="color: #333;">Order Items:</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background-color: #f2f2f2;">
            <th style="padding: 8px; text-align: left; border-bottom: 1px solid #ddd;">Item</th>
            <th style="padding: 8px; text-align: center; border-bottom: 1px solid #ddd;">Quantity</th>
            <th style="padding: 8px; text-align: right; border-bottom: 1px solid #ddd;">Price</th>
          </tr>
        </thead>
        <tbody>
          ${order.items.map(item => `
            <tr>
              <td style="padding: 8px; text-align: left; border-bottom: 1px solid #ddd;">${item.name} ${item.variant ? `(${item.variant})` : ''}</td>
              <td style="padding: 8px; text-align: center; border-bottom: 1px solid #ddd;">${item.quantity}</td>
              <td style="padding: 8px; text-align: right; border-bottom: 1px solid #ddd;">₦${item.price.toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2" style="padding: 8px; text-align: right; border-top: 1px solid #ddd;"><strong>Subtotal:</strong></td>
            <td style="padding: 8px; text-align: right; border-top: 1px solid #ddd;">₦${order.subtotal.toFixed(2)}</td>
          </tr>
          <tr>
            <td colspan="2" style="padding: 8px; text-align: right;"><strong>Shipping:</strong></td>
            <td style="padding: 8px; text-align: right;">₦${order.shippingFee.toFixed(2)}</td>
          </tr>
          ${order.tax > 0 ? `
            <tr>
              <td colspan="2" style="padding: 8px; text-align: right;"><strong>Tax:</strong></td>
              <td style="padding: 8px; text-align: right;">₦${order.tax.toFixed(2)}</td>
            </tr>
          ` : ''}
          <tr>
            <td colspan="2" style="padding: 8px; text-align: right; border-top: 1px solid #ddd;"><strong>Total:</strong></td>
            <td style="padding: 8px; text-align: right; border-top: 1px solid #ddd;"><strong>₦${order.totalAmount.toFixed(2)}</strong></td>
          </tr>
        </tfoot>
      </table>
      
      <div style="margin-top: 30px;">
        <p>We'll notify you when your order has been shipped.</p>
        <p>Thank you for shopping with Scenture Lagos!</p>
      </div>
      
      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #777;">
        <p>If you have any questions, please contact our customer service at support@scenture.com</p>
      </div>
    </div>
  `;

  return await exports.sendEmail({
    to: customerEmail,
    subject,
    text,
    html
  });
};