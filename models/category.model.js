const mongoose = require('mongoose');
const slugify = require('slugify'); // Import slugify package

const CategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a category name'],
    unique: true,
    trim: true,
    maxlength: [50, 'Category name cannot be more than 50 characters']
  },
  slug: {
    type: String,
    unique: true
  },
  description: {
    type: String,
    maxlength: [500, 'Description cannot be more than 500 characters']
  },
  image: {
    type: String
  },
  featured: {
    type: Boolean,
    default: false
  },
  parent: {
    type: mongoose.Schema.ObjectId,
    ref: 'Category',
    default: null
  },
  createdBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date
  }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Create category slug from the name
CategorySchema.pre('save', function(next) {
  if (this.isModified('name')) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }
  
  // Set updatedAt date
  this.updatedAt = Date.now();
  
  next();
});

// Virtual for products in this category
CategorySchema.virtual('products', {
  ref: 'Product',
  localField: '_id',
  foreignField: 'category',
  justOne: false
});

// Static method to get category tree
CategorySchema.statics.getCategoryTree = async function () {
  const categories = await this.find({})
    .populate('parent', 'name slug')
    .populate('products'); // Populate the products virtual

  const categoryMap = {};
  const tree = [];

  // Map categories with product count
  categories.forEach(category => {
    categoryMap[category._id] = {
      _id: category._id,
      name: category.name,
      slug: category.slug,
      productCount: category.products ? category.products.length : 0, // Add product count
      children: []
    };
  });

  // Build the tree
  categories.forEach(category => {
    if (category.parent) {
      categoryMap[category.parent._id].children.push(categoryMap[category._id]);
    } else {
      tree.push(categoryMap[category._id]);
    }
  });

  return tree;
};

module.exports = mongoose.model('Category', CategorySchema);