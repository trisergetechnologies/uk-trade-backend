const express = require('express');
const { authRequired, allowRoles } = require('../middlewares/auth.middleware');
const { ROLES } = require('../constants/roles');
const { validate } = require('../validators/validate');
const { upload } = require('../middlewares/upload.middleware');
const {
  createFundRequest,
  listMyFundRequests,
  adminListFundRequests,
  adminGetFundRequest,
  adminReviewFundRequest,
} = require('../controllers/funding.controller');
const { createFundRequestSchema, adminReviewFundSchema, adminGetFundRequestSchema } = require('../validators/funding.validator');

const router = express.Router();

router.post('/', authRequired, upload.single('screenshot'), validate(createFundRequestSchema), createFundRequest);
router.get('/me', authRequired, listMyFundRequests);
router.get('/admin', authRequired, allowRoles(ROLES.ADMIN), adminListFundRequests);
router.get('/admin/:id', authRequired, allowRoles(ROLES.ADMIN), validate(adminGetFundRequestSchema), adminGetFundRequest);
router.patch('/admin/:id/review', authRequired, allowRoles(ROLES.ADMIN), validate(adminReviewFundSchema), adminReviewFundRequest);

module.exports = router;
