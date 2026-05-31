const express = require('express');
const { authRequired, allowRoles } = require('../middlewares/auth.middleware');
const { ROLES } = require('../constants/roles');
const { validate } = require('../validators/validate');
const {
  adminGetPaymentProof,
  adminGetUser,
  adminGetUserWalletLedger,
  adminLookupUser,
  adminListAuditLogs,
  adminListUsers,
  adminListUsersPasswords,
  adminOverview,
  adminSetUserStatus,
  adminCreditUser,
  adminPurchaseForUser,
  adminGetUserPassword,
  adminCommunityUsers,
  adminCommunityTotals,
  adminUserTeamTree,
  adminUserTeamTreeChildren,
  adminUserTeamFocus,
  adminListPlans,
  adminCreatePlan,
  adminUpdatePlan,
  adminListPackages,
  adminCreatePackage,
  adminUpdatePackage,
} = require('../controllers/admin.controller');
const {
  adminMediaPaymentProofSchema,
  adminSetUserStatusSchema,
  adminUserCodeParamSchema,
  adminLookupUserParamSchema,
  adminCreditWalletSchema,
  adminPurchaseOnBehalfSchema,
  adminCommunityUsersSchema,
  adminUserTeamTreeSchema,
  adminUserTeamTreeChildrenSchema,
  adminUserTeamFocusSchema,
  adminUserWalletLedgerSchema,
  adminCreatePlanSchema,
  adminCreatePackageSchema,
  adminPatchPlanSchema,
  adminPatchPackageSchema,
} = require('../validators/admin.validator');
const { adminKycList, adminKycReview, adminKycDocument } = require('../controllers/kyc.controller');
const { adminListKycSchema, adminReviewKycSchema, adminKycMediaSchema } = require('../validators/kyc.validator');

const router = express.Router();

router.use(authRequired, allowRoles(ROLES.ADMIN));
router.get('/overview', adminOverview);
router.get('/community-totals', adminCommunityTotals);
router.get('/community-users', validate(adminCommunityUsersSchema), adminCommunityUsers);
router.get('/user-passwords', adminListUsersPasswords);
router.get('/users', adminListUsers);
router.get('/users/lookup/:userCode', validate(adminLookupUserParamSchema), adminLookupUser);
router.get('/users/:userCode/password', validate(adminUserCodeParamSchema), adminGetUserPassword);
router.get(
  '/users/:userCode/wallet/ledger',
  validate(adminUserWalletLedgerSchema),
  adminGetUserWalletLedger
);
router.get(
  '/users/:userCode/team/tree/children',
  validate(adminUserTeamTreeChildrenSchema),
  adminUserTeamTreeChildren
);
router.get('/users/:userCode/team/tree/focus', validate(adminUserTeamFocusSchema), adminUserTeamFocus);
router.get('/users/:userCode/team/tree', validate(adminUserTeamTreeSchema), adminUserTeamTree);
router.post('/users/:userCode/credit', validate(adminCreditWalletSchema), adminCreditUser);
router.post('/users/:userCode/purchase', validate(adminPurchaseOnBehalfSchema), adminPurchaseForUser);
router.get('/users/:userCode', validate(adminUserCodeParamSchema), adminGetUser);
router.patch('/users/:userCode/status', validate(adminSetUserStatusSchema), adminSetUserStatus);
router.get('/audit-logs', adminListAuditLogs);
router.get('/media/payment-proof/:id', validate(adminMediaPaymentProofSchema), adminGetPaymentProof);
router.get('/kyc', validate(adminListKycSchema), adminKycList);
router.patch('/kyc/:userCode/review', validate(adminReviewKycSchema), adminKycReview);
router.get('/media/kyc/:userCode/:kind', validate(adminKycMediaSchema), adminKycDocument);
router.get('/plans', adminListPlans);
router.post('/plans', validate(adminCreatePlanSchema), adminCreatePlan);
router.patch('/plans/:code', validate(adminPatchPlanSchema), adminUpdatePlan);
router.get('/package-products', adminListPackages);
router.post('/package-products', validate(adminCreatePackageSchema), adminCreatePackage);
router.patch('/package-products/:code', validate(adminPatchPackageSchema), adminUpdatePackage);

module.exports = router;
