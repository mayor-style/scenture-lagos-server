const express = require('express');
const dotenv = require('dotenv');
const morgan = require('morgan');
const cors = require('cors');
const helmet = require('helmet');
const xss = require('xss-clean');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cookieParser = require('cookie-parser');
const path = require('path');

// Load environment variables
dotenv.config();

// Import DB connection
const connectDB = require('./config/db');

// Import routes
const routes = require('./routes');

// Import error handler middleware
const { errorHandler } = require('./middleware/error.middleware');

// Connect to database
connectDB();

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

// --- CORE MIDDLEWARE SETUP ---

// ADDED: Trust the first proxy in front of the app (essential for secure cookies in production)
app.set('trust proxy', 1);

// Body parser
app.use(express.json());

// Cookie parser
app.use(cookieParser());

// Enable CORS - Place this before session and routes
const allowedOrigins = isProduction
  ? ['https://scenture-lagos.vercel.app']
  // Allow your specific dev ports and the production preview
  : ['http://localhost:5173', 'http://localhost:5174', 'https://scenture-lagos.vercel.app'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// Session middleware - CORRECTED FOR PRODUCTION
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  // CHANGED: Set to true to ensure a session is created for guest users immediately.
  saveUninitialized: true,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    ttl: 14 * 24 * 60 * 60 // 14 days
  }),
  cookie: {
    maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days
    httpOnly: true,
    secure: isProduction, // requires HTTPS in production
    // CHANGED: This is the critical setting for cross-domain cookies.
    sameSite: isProduction ? 'none' : 'lax',
  }
}));


// --- SECURITY AND LOGGING MIDDLEWARE ---

// Dev logging middleware
if (!isProduction) {
  app.use(morgan('dev'));
}

// Security middleware
app.use(helmet());
app.use(xss());
app.use(mongoSanitize());

// Rate limiting
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 1000 // limit each IP to 1000 requests per windowMs
});
app.use('/api', limiter);


// --- ROUTES ---

// Set static folder for uploads
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Mount API routes
app.use('/api/v1', routes);

// Root route for health check
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Scenture Lagos API' });
});


// --- ERROR HANDLING ---

// Handle unhandled routes (404)
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.originalUrl}`
  });
});

// Use the custom error handler last
app.use(errorHandler);


// --- SERVER INITIALIZATION ---

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.log(`Error: ${err.message}`);
  // Close server & exit process
  server.close(() => process.exit(1));
});