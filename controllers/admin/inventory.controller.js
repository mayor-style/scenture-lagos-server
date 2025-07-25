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

    const aggregationResults = await Product.aggregate([
      { $match: filter },
      {
        $facet: {
          items: [
            { $sort: { [req.query.sort || 'name']: 1 } },
            { $skip: startIndex },
            { $limit: limit },
            {
              $lookup: {
                from: 'categories',
                localField: 'category',
                foreignField: '_id',
                as: 'category',
              },
            },
            {
              $unwind: { path: '$category', preserveNullAndEmptyArrays: true },
            },
            {
              $project: {
                name: 1,
                sku: 1,
                price: 1,
                stockQuantity: 1,
                reorderPoint: 1,
                category: { _id: '$category._id', name: '$category.name' },
                variants: 1,
                images: 1,
              },
            },
          ],
          total: [{ $count: 'count' }],
          summary: [
            {
              $group: {
                _id: null,
                totalProducts: { $sum: 1 },
                totalStock: { $sum: '$stockQuantity' },
                lowStockProducts: { $sum: { $cond: [{ $and: [{ $lte: ['$stockQuantity', lowStockThreshold] }, { $gt: ['$stockQuantity', 0] }] }, 1, 0] } },
                outOfStockProducts: { $sum: { $cond: [{ $lte: ['$stockQuantity', 0] }, 1, 0] } },
              },
            },
          ],
        },
      },
    ]);

    const products = aggregationResults[0].items;
    const total = aggregationResults[0].total[0]?.count || 0;
    const summaryData = aggregationResults[0].summary[0] || { totalProducts: 0, totalStock: 0, lowStockProducts: 0, outOfStockProducts: 0 };
    
    const totalInventoryValue = await Product.getTotalInventoryValue();

    const items = products.map(product => ({
      ...product,
      // ✅ CRITICAL CHANGE: Return machine-readable status
      status: product.stockQuantity > lowStockThreshold ? 'in_stock' : product.stockQuantity > 0 ? 'low_stock' : 'out_of_stock',
      reorder_point: product.reorderPoint || lowStockThreshold,
    }));

    // Construct the full summary for the response
    const summary = {
        ...summaryData,
        inStockProducts: summaryData.totalProducts - summaryData.lowStockProducts - summaryData.outOfStockProducts
    };

    return paginate(
      res,
      'Inventory retrieved successfully',
      {
        items,
        summary,
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
    
    const settings = await Settings.getSettings();
    const lowStockThreshold = settings.lowStockThreshold || 10;

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
      reorder_point: product.reorderPoint || lowStockThreshold, // CORRECTED: Use threshold for consistency
    }));

    return paginate(res, 'Out of stock products retrieved successfully', { items }, page, limit, total);
  } catch (err) {
    next(err);
  }
};

exports.adjustStock = async (req, res, next) => {
  try {
    const { adjustment, reason, variantId, allowNegative } = req.body;
    const numericAdjustment = parseInt(adjustment, 10);

    if (!numericAdjustment) {
      return next(new ErrorResponse('Please provide a valid adjustment value', 400));
    }
    if (!reason) {
      return next(new ErrorResponse('Please provide a reason for the adjustment', 400));
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    // CORRECTED & CENTRALIZED: Use the model's method to handle adjustments.
    // This removes the buggy logic from the controller.
    
    // First, perform the negative stock check
    const itemToCheck = variantId ? product.variants.id(variantId) : product;

    if (!itemToCheck) {
      return next(new ErrorResponse(`Variant not found with id of ${variantId}`, 404));
    }

    if (itemToCheck.stockQuantity + numericAdjustment < 0 && !allowNegative) {
      return next(new ErrorResponse('Stock adjustment would result in negative stock.', 400));
    }
    
    // Now, call the robust method from the model
    product.adjustStock({
      adjustment: numericAdjustment,
      reason,
      userId: req.user.id,
      variantId,
    });

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

    const doc = new PDFDocument({ margin: 50 });
    const reportPath = path.join(__dirname, `../../reports/inventory-report-${Date.now()}.pdf`);
    
    res.setHeader('Content-disposition', 'attachment; filename=inventory-report.pdf');
    res.setHeader('Content-type', 'application/pdf');

    doc.pipe(fs.createWriteStream(reportPath)).on('finish', () => {
        res.download(reportPath, 'inventory-report.pdf', (err) => {
            if (err) {
                // Handle error, but don't re-throw if headers are already sent
                console.error('Error sending file:', err);
            }
            // Clean up the file
            fs.unlinkSync(reportPath);
        });
    });

    doc.fontSize(20).text('Inventory Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Generated on: ${new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}`);
    doc.moveDown();

    const summaryData = await Product.aggregate([
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          lowStockProducts: { $sum: { $cond: [{ $and: [{ $lte: ['$stockQuantity', lowStockThreshold] }, { $gt: ['$stockQuantity', 0] }] }, 1, 0] } },
          outOfStockProducts: { $sum: { $cond: [{ $lte: ['$stockQuantity', 0] }, 1, 0] } },
        },
      },
    ]);
    const summary = summaryData[0] || {};
    
    doc.text(`Total Products: ${summary.totalProducts || 0}`);
    doc.text(`Low Stock (Threshold: ${lowStockThreshold}): ${summary.lowStockProducts || 0}`);
    doc.text(`Out of Stock: ${summary.outOfStockProducts || 0}`);
    doc.moveDown(2);

    doc.fontSize(14).text('Inventory Details', { underline: true });
    doc.moveDown();

    products.forEach(product => {
      doc.fontSize(10).text(`Name: ${product.name}`);
      doc.text(`SKU: ${product.sku || 'N/A'}`);
      doc.text(`Stock: ${product.stockQuantity}`);
      doc.text(`Price: ${settings.currency.symbol}${product.price.toFixed(2)}`);
      doc.text(`Category: ${product.category?.name || 'N/A'}`);
      doc.moveDown();
    });

    doc.end();

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

    const data = products.map(p => p.toJSON()); // Convert Mongoose docs to plain objects

    const fields = [
      { label: 'Name', value: 'name' },
      { label: 'SKU', value: 'sku' },
      { label: 'Category', value: 'category.name' },
      { label: 'Stock', value: 'stockQuantity' },
      { label: 'Price', value: 'price' },
      { label: 'Reorder Point', value: 'reorderPoint' },
      { 
        label: 'Status', 
        value: row => (row.stockQuantity > lowStockThreshold ? 'In Stock' : row.stockQuantity > 0 ? 'Low Stock' : 'Out of Stock') 
      },
    ];

    const parser = new Parser({ fields });
    const csv = parser.parse(data);
    res.header('Content-Type', 'text/csv');
    res.attachment('inventory-export.csv');
    res.send(csv);
  } catch (err) {
    next(err);
  }
};

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