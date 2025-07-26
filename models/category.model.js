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

}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Create category slug from the name and update timestamp
CategorySchema.pre('save', function (next) {
    if (this.isModified('name')) {
        this.slug = slugify(this.name, { lower: true, strict: true });
    }
    this.updatedAt = Date.now();
    next();
});

// Validate updates
CategorySchema.pre('findOneAndUpdate', function (next) {
    if (this._update.name) {
        this._update.slug = slugify(this._update.name, { lower: true, strict: true });
    }
    this._update.updatedAt = Date.now();
    next();
});

// Virtual for products in this category
CategorySchema.virtual('products', {
    ref: 'Product',
    localField: '_id',
    foreignField: 'category',
    justOne: false,
});

// Static method to get category tree
CategorySchema.statics.getCategoryTree = async function () {
    const categories = await this.find({})
        .populate('parent', 'name slug')
        .populate('products');

    const categoryMap = {};
    const tree = [];

    categories.forEach((category) => {
        categoryMap[category._id] = {
            _id: category._id,
            name: category.name,
            slug: category.slug,
            productCount: category.products ? category.products.length : 0,
            children: [],
        };
    });

    categories.forEach((category) => {
        if (category.parent) {
            // Ensure parent exists in map before pushing to children
            if (categoryMap[category.parent._id]) {
                categoryMap[category.parent._id].children.push(categoryMap[category._id]);
            }
        } else {
            tree.push(categoryMap[category._id]);
        }
    });

    return tree;
};
module.exports = mongoose.model('Category', CategorySchema);
