const express = require('express');
const { authRequired } = require('../middlewares/auth.middleware');
const { validate } = require('../validators/validate');
const { updateBankAccountSchema } = require('../validators/bank-account.validator');
const { getMyBankAccount, upsertMyBankAccount } = require('../controllers/bank-account.controller');

const router = express.Router();

router.get('/me', authRequired, getMyBankAccount);
router.put('/me', authRequired, validate(updateBankAccountSchema), upsertMyBankAccount);

module.exports = router;
