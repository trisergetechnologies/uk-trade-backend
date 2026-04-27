const express = require('express');
const { authRequired } = require('../middlewares/auth.middleware');
const { myWallet, myLedger } = require('../controllers/wallet.controller');

const router = express.Router();

router.get('/me', authRequired, myWallet);
router.get('/ledger', authRequired, myLedger);

module.exports = router;
