const express = require('express');
const { authRequired } = require('../middlewares/auth.middleware');
const { validate } = require('../validators/validate');
const { uploadKyc } = require('../middlewares/upload.middleware');
const { submitKyc, myKyc, myKycDocument } = require('../controllers/kyc.controller');
const { submitKycSchema, myKycDocumentSchema } = require('../validators/kyc.validator');

const router = express.Router();

const kycFields = uploadKyc.fields([
  { name: 'aadhaar', maxCount: 1 },
  { name: 'passbook', maxCount: 1 },
]);

router.get('/me', authRequired, myKyc);
router.post('/me', authRequired, kycFields, validate(submitKycSchema), submitKyc);
router.get('/me/document/:kind', authRequired, validate(myKycDocumentSchema), myKycDocument);

module.exports = router;
