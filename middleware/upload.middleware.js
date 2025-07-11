const path = require('path');
const multer = require('multer');
const { ErrorResponse } = require('./error.middleware');

// Set storage engine
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, process.env.FILE_UPLOAD_PATH || './public/uploads');
  },
  filename: function(req, file, cb) {
    // Create unique filename with original extension
    cb(
      null,
      `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`
    );
  }
});

// Check file type
const fileFilter = (req, file, cb) => {
  // Allowed extensions
  const filetypes = /jpeg|jpg|png|webp/;
  // Check extension
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  // Check mime type
  const mimetype = filetypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new ErrorResponse('File type not supported. Please upload an image file (jpeg, jpg, png, webp)', 400));
  }
};

// Initialize upload
const upload = multer({
  storage,
  limits: {
    fileSize: process.env.MAX_FILE_UPLOAD || 1000000 // 1MB default
  },
  fileFilter
});

// Middleware for handling multer errors
const handleUploadErrors = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: `File too large. Maximum size is ${process.env.MAX_FILE_UPLOAD / 1000000}MB`
      });
    }
    return res.status(400).json({
      success: false,
      error: err.message
    });
  }
  next(err);
};

module.exports = {
  upload,
  handleUploadErrors
};