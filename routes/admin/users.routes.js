const express = require('express');
const {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser
} = require('../../controllers/admin/users.controller');

const { protect, authorize } = require('../../middleware/auth.middleware');

const router = express.Router();

// Apply protection and authorization to all routes
router.use(protect);
router.use(authorize('admin', 'superadmin'));

router
  .route('/')
  .get(getUsers)
  .post(createUser);

router
  .route('/:id')
  .get(getUser)
  .put(updateUser)
  .delete(deleteUser);

module.exports = router;