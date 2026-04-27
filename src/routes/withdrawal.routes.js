const express = require('express');
const { authRequired, allowRoles } = require('../middlewares/auth.middleware');
const { ROLES } = require('../constants/roles');
const { validate } = require('../validators/validate');
const {
  requestWithdrawal,
  myWithdrawalSummary,
  listMyWithdrawals,
  adminListWithdrawals,
  adminReviewWithdrawal,
} = require('../controllers/withdrawal.controller');
const { withdrawalRequestSchema, adminReviewWithdrawalSchema } = require('../validators/withdrawal.validator');

const router = express.Router();

router.post('/', authRequired, validate(withdrawalRequestSchema), requestWithdrawal);
router.get('/me/summary', authRequired, myWithdrawalSummary);
router.get('/me', authRequired, listMyWithdrawals);
router.get('/admin', authRequired, allowRoles(ROLES.ADMIN), adminListWithdrawals);
router.patch('/admin/:id/review', authRequired, allowRoles(ROLES.ADMIN), validate(adminReviewWithdrawalSchema), adminReviewWithdrawal);

module.exports = router;
