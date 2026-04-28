const express = require('express');
const { MatchingIncomeEvent, SponsorIncomeEvent, TradeCreditEvent } = require('../models');
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

router.get('/matching', authRequired, async (req, res, next) => {
  try {
    const rows = await MatchingIncomeEvent.find({ earnerUserId: req.user.sub }).sort({ createdAt: -1 });
    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
