const express = require('express');
const { authRequired } = require('../middlewares/auth.middleware');
const { validate } = require('../validators/validate');
const { createFundTransferSchema } = require('../validators/fund-transfer.validator');
const { transferToUser, myTransfers } = require('../controllers/fund-transfer.controller');

const router = express.Router();

router.post('/user', authRequired, validate(createFundTransferSchema), transferToUser);
router.get('/me', authRequired, myTransfers);

module.exports = router;
