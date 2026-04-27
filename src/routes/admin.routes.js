const express = require('express');
const { authRequired, allowRoles } = require('../middlewares/auth.middleware');
const { ROLES } = require('../constants/roles');
const { validate } = require('../validators/validate');
const {
  adminGetPaymentProof,
  adminGetUser,
  adminListAuditLogs,
  adminListUsers,
  adminOverview,
  adminSetUserStatus,
  adminListPlans,
  adminCreatePlan,
  adminListPackages,
  adminCreatePackage,
} = require('../controllers/admin.controller');
const {
  adminMediaPaymentProofSchema,
  adminSetUserStatusSchema,
  adminUserCodeParamSchema,
  adminCreatePlanSchema,
  adminCreatePackageSchema,
} = require('../validators/admin.validator');

const router = express.Router();

router.use(authRequired, allowRoles(ROLES.ADMIN));
router.get('/overview', adminOverview);
router.get('/users', adminListUsers);
router.get('/users/:userCode', validate(adminUserCodeParamSchema), adminGetUser);
router.patch('/users/:userCode/status', validate(adminSetUserStatusSchema), adminSetUserStatus);
router.get('/audit-logs', adminListAuditLogs);
router.get('/media/payment-proof/:id', validate(adminMediaPaymentProofSchema), adminGetPaymentProof);
router.get('/plans', adminListPlans);
router.post('/plans', validate(adminCreatePlanSchema), adminCreatePlan);
router.get('/package-products', adminListPackages);
router.post('/package-products', validate(adminCreatePackageSchema), adminCreatePackage);

module.exports = router;
