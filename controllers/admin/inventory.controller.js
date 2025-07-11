const Product = require('../../models/product.model');
const Settings = require('../../models/settings.model');
const { ErrorResponse } = require('../../middleware/error.middleware');
const { success, paginate } = require('../../utils/response.util');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { Parser } = require('json2csv');

exports.getInventory = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;

    const settings = await Settings.getSettings();
    const lowStockThreshold = settings.lowStockThreshold || 10;

    const filter = {};
    if (req.query.stockStatus) {
      switch (req.query.stockStatus) {
        case 'low':
          filter.stockQuantity = { $lte: lowStockThreshold, $gt: 0 };
          break;
        case 'out':
          filter.stockQuantity = { $lte: 0 };
          break;
        case 'in':
          filter.stockQuantity = { $gt: lowStockThreshold };
          break;
      }
    }
    if (req.query.category) filter.category = req.query.category;
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      filter.$or = [{ name: searchRegex }, { sku: searchRegex }];
    }

    const total = await Product.countDocuments(filter);
    const products = await Product.find(filter)
      .select('name sku stockQuantity reorderPoint category variants images status')
      .populate('category', 'name')
      .sort(req.query.sort || 'name')
      .skip(startIndex)
      .limit(limit);

    const items = products.map(product => ({
      ...product.toJSON(),
      status: product.stockQuantity > lowStockThreshold ? 'In Stock' : product.stockQuantity > 0 ? 'Low Stock' : 'Out of Stock',
      reorder_point: product.reorderPoint || lowStockThreshold,
    }));

    const totalInventoryValue = await Product.getTotalInventoryValue();
    const inventorySummary = await Product.aggregate([
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          totalStock: { $sum: '$stockQuantity' },
          lowStockProducts: { $sum: { $cond: [{ $and: [{ $lte: ['$stockQuantity', lowStockThreshold] }, { $gt: ['$stockQuantity', 0] }] }, 1, 0] } },
          outOfStockProducts: { $sum: { $cond: [{ $lte: ['$stockQuantity', 0] }, 1, 0] } },
        },
      },
    ]);

    return paginate(
      res,
      'Inventory retrieved successfully',
      {
        items,
        total,
        summary: inventorySummary[0] || { totalProducts: 0, totalStock: 0, lowStockProducts: 0, outOfStockProducts: 0 },
        totalInventoryValue,
      },
      page,
      limit,
      total
    );
  } catch (err) {
    next(err);
  }
};

exports.getLowStockProducts = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;

    const settings = await Settings.getSettings();
    const lowStockThreshold = settings.lowStockThreshold || 10;

    const filter = { stockQuantity: { $lte: lowStockThreshold, $gt: 0 } };
    if (req.query.category) filter.category = req.query.category;

    const total = await Product.countDocuments(filter);
    const products = await Product.find(filter)
      .select('name sku stockQuantity reorderPoint category variants images status')
      .populate('category', 'name')
      .sort('stockQuantity')
      .skip(startIndex)
      .limit(limit);

    const items = products.map(product => ({
      ...product.toJSON(),
      status: 'Low Stock',
      reorder_point: product.reorderPoint || lowStockThreshold,
    }));

    return paginate(res, 'Low stock products retrieved successfully', { items }, page, limit, total);
  } catch (err) {
    next(err);
  }
};

exports.getOutOfStockProducts = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;

    const filter = { stockQuantity: { $lte: 0 } };
    if (req.query.category) filter.category = req.query.category;

    const total = await Product.countDocuments(filter);
    const products = await Product.find(filter)
      .select('name sku stockQuantity reorderPoint category variants images status')
      .populate('category', 'name')
      .sort('name')
      .skip(startIndex)
      .limit(limit);

    const items = products.map(product => ({
      ...product.toJSON(),
      status: 'Out of Stock',
      reorder_point: product.reorderPoint || 10,
    }));

    return paginate(res, 'Out of stock products retrieved successfully', { items }, page, limit, total);
  } catch (err) {
    next(err);
  }
};

exports.adjustStock = async (req, res, next) => {
  try {
    const { adjustment, reason, variantId } = req.body;

    if (!adjustment) {
      return next(new ErrorResponse('Please provide an adjustment value', 400));
    }

    if (!reason) {
      return next(new ErrorResponse('Please provide a reason for the adjustment', 400));
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    if (variantId) {
      const variant = product.variants.id(variantId);
      if (!variant) {
        return next(new ErrorResponse(`Variant not found with id of ${variantId}`, 404));
      }

      const newStock = variant.stockQuantity + parseInt(adjustment, 10);
      if (newStock < 0 && !req.body.allowNegative) {
        return next(new ErrorResponse('Stock adjustment would result in negative stock.', 400));
      }

      variant.stockQuantity = newStock;
      product.stockAdjustments.push({
        variantId,
        adjustment: parseInt(adjustment, 10),
        reason,
        previousStock: variant.stockQuantity - parseInt(adjustment, 10),
        newStock: variant.stockQuantity,
        adjustedBy: req.user.id,
        adjustedAt: Date.now(),
      });
    } else {
      const newStock = product.stockQuantity + parseInt(adjustment, 10);
      if (newStock < 0 && !req.body.allowNegative) {
        return next(new ErrorResponse('Stock adjustment would result in negative stock.', 400));
      }

      product.stockQuantity = newStock;
      product.stockAdjustments.push({
        adjustment: parseInt(adjustment, 10),
        reason,
        previousStock: product.stockQuantity - parseInt(adjustment, 10),
        newStock: product.stockQuantity,
        adjustedBy: req.user.id,
        adjustedAt: Date.now(),
      });
    }

    await product.save();
    return success(res, 'Stock adjusted successfully', { product });
  } catch (err) {
    next(err);
  }
};

exports.getStockHistory = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id).populate({
      path: 'stockAdjustments.adjustedBy',
      select: 'firstName lastName',
    });

    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    const history = product.stockAdjustments || [];
    history.sort((a, b) => b.adjustedAt - a.adjustedAt);

    return success(res, 'Stock adjustment history retrieved successfully', { history });
  } catch (err) {
    next(err);
  }
};


exports.generateInventoryReport = async (req, res, next) => {
  try {
    const products = await Product.find()
      .select('name sku stockQuantity reorderPoint price category')
      .populate('category', 'name');

    const settings = await Settings.getSettings();
    const lowStockThreshold = settings.lowStockThreshold || 10;

    const doc = new PDFDocument();
    const reportPath = path.join(__dirname, `../../reports/inventory-report-${Date.now()}.pdf`);
    doc.pipe(fs.createWriteStream(reportPath));

    doc.fontSize(20).text('Inventory Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Generated on: ${new Date().toLocaleString()}`);
    doc.moveDown();

    const summary = await Product.aggregate([
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          lowStockProducts: { $sum: { $cond: [{ $and: [{ $lte: ['$stockQuantity', lowStockThreshold] }, { $gt: ['$stockQuantity', 0] }] }, 1, 0] } },
          outOfStockProducts: { $sum: { $cond: [{ $lte: ['$stockQuantity', 0] }, 1, 0] } },
        },
      },
    ]);

    doc.text(`Total Products: ${summary[0]?.totalProducts || 0}`);
    doc.text(`Low Stock (Threshold: ${lowStockThreshold}): ${summary[0]?.lowStockProducts || 0}`);
    doc.text(`Out of Stock: ${summary[0]?.outOfStockProducts || 0}`);
    doc.moveDown();

    doc.text('Inventory Details:', { underline: true });
    products.forEach(product => {
      doc.text(`Name: ${product.name}`);
      doc.text(`SKU: ${product.sku}`);
      doc.text(`Stock: ${product.stockQuantity}`);
      doc.text(`Reorder Point: ${product.reorderPoint || lowStockThreshold}`);
      doc.text(`Price: ${product.price}`);
      doc.text(`Category: ${product.category?.name || 'N/A'}`);
      doc.moveDown();
    });

    doc.end();

    res.download(reportPath, 'inventory-report.pdf', err => {
      if (err) next(err);
      fs.unlinkSync(reportPath);
    });
  } catch (err) {
    next(err);
  }
};

exports.exportInventoryCSV = async (req, res, next) => {
  try {
    const products = await Product.find()
      .select('name sku stockQuantity reorderPoint price category status')
      .populate('category', 'name');

    const settings = await Settings.getSettings();
    const lowStockThreshold = settings.lowStockThreshold || 10;

    const fields = [
      { label: 'Name', value: 'name' },
      { label: 'SKU', value: 'sku' },
      { label: 'Stock', value: 'stockQuantity' },
      { label: 'Reorder Point', value: 'reorderPoint' },
      { label: 'Price', value: 'price' },
      { label: 'Category', value: 'category.name' },
      { label: 'Status', value: row => (row.stockQuantity > lowStockThreshold ? 'In Stock' : row.stockQuantity > 0 ? 'Low Stock' : 'Out of Stock') },
    ];

    const csv = new Parser({ fields }).parse(products);
    res.header('Content-Type', 'text/csv');
    res.attachment('inventory-export.csv');
    res.send(csv);
  } catch (err) {
    next(err);
  }
};

/**
 * Get a single inventory item by ID
 * @route GET /api/admin/inventory/:id
 * @access Private (Admin, SuperAdmin)
 */
exports.getInventoryItem = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id)
      .select('name sku stockQuantity reorderPoint price category variants images status')
      .populate('category', 'name');

    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    const settings = await Settings.getSettings();
    const lowStockThreshold = settings.lowStockThreshold || 10;

    const productData = {
      ...product.toJSON(),
      status: product.stockQuantity > lowStockThreshold ? 'in_stock' : product.stockQuantity > 0 ? 'low_stock' : 'out_of_stock',
      reorder_point: product.reorderPoint || lowStockThreshold,
    };

    return success(res, 'Inventory item retrieved successfully', { product: productData });
  } catch (err) {
    next(err);
  }
};