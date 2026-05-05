const express = require('express');

const authRoutes = require('./auth.routes');
const fundingRoutes = require('./funding.routes');
const packageRoutes = require('./package.routes');
const walletRoutes = require('./wallet.routes');
const withdrawalRoutes = require('./withdrawal.routes');
const networkRoutes = require('./network.routes');
const incomeRoutes = require('./income.routes');
const holidayRoutes = require('./holiday.routes');
const bankAccountRoutes = require('./bank-account.routes');
const fundTransferRoutes = require('./fund-transfer.routes');
const adminRoutes = require('./admin.routes');
const kycRoutes = require('./kyc.routes');

const router = express.Router();

router.get('/health', (req, res) => res.json({ success: true, service: 'uk-trade-backend', timestamp: new Date().toISOString() }));
router.use('/auth', authRoutes);
router.use('/fund-requests', fundingRoutes);
router.use('/', packageRoutes);
router.use('/wallet', walletRoutes);
router.use('/withdrawals', withdrawalRoutes);
router.use('/network', networkRoutes);
router.use('/income', incomeRoutes);
router.use('/holidays', holidayRoutes);
router.use('/bank-account', bankAccountRoutes);
router.use('/fund-transfers', fundTransferRoutes);
router.use('/kyc', kycRoutes);
router.use('/admin', adminRoutes);

module.exports = router;
