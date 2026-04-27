const express = require('express');
const { authRequired } = require('../middlewares/auth.middleware');
const { validate } = require('../validators/validate');
const { purchasePackageSchema } = require('../validators/package.validator');
const { listPlans, listPackageProducts, purchase, myPackages } = require('../controllers/package.controller');

const router = express.Router();

router.get('/plans', authRequired, listPlans);
router.get('/package-products', authRequired, listPackageProducts);
router.post('/packages/purchase', authRequired, validate(purchasePackageSchema), purchase);
router.get('/packages/me', authRequired, myPackages);

module.exports = router;
