const express = require('express');
const { SponsorIncomeEvent, TradeCreditEvent } = require('../models');
const { authRequired } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/trade', authRequired, async (req, res, next) => {
  try {
    const rows = await TradeCreditEvent.find({ userId: req.user.sub }).sort({ createdAt: -1 });
    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

router.get('/sponsor', authRequired, async (req, res, next) => {
  try {
    const rows = await SponsorIncomeEvent.find({ referrerUserId: req.user.sub }).sort({ createdAt: -1 });
    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

router.get('/matching', authRequired, async (req, res) => {
  res.json({
    success: true,
    data: [],
    message: 'Matching income is not specified in BUSINESS-LOGIC yet (§9).',
  });
});

module.exports = router;
