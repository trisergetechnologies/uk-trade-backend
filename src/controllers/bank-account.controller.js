const { User } = require('../models');

function toResponse(userDoc) {
  const b = userDoc?.bankAccount || {};
  const accountDigits = String(b.accountNumber || '').replace(/\D/g, '');
  return {
    accountHolderName: String(b.accountHolderName || ''),
    bankName: String(b.bankName || ''),
    accountNumberMasked: accountDigits ? `••••${accountDigits.slice(-4)}` : '',
    ifscCode: String(b.ifscCode || ''),
    upiId: String(b.upiId || ''),
    updatedAtUtc: b.updatedAtUtc || null,
    isComplete: Boolean(
      String(b.accountHolderName || '').trim() &&
        String(b.bankName || '').trim() &&
        String(b.accountNumber || '').trim() &&
        String(b.ifscCode || '').trim()
    ),
  };
}

async function getMyBankAccount(req, res, next) {
  try {
    const user = await User.findById(req.user.sub);
    res.json({ success: true, data: toResponse(user) });
  } catch (error) {
    next(error);
  }
}

async function upsertMyBankAccount(req, res, next) {
  try {
    const body = req.validated.body;
    const clean = {
      accountHolderName: String(body.accountHolderName || '').trim(),
      bankName: String(body.bankName || '').trim(),
      accountNumber: String(body.accountNumber || '').trim(),
      ifscCode: String(body.ifscCode || '').trim().toUpperCase(),
      upiId: String(body.upiId || '').trim().toLowerCase(),
      updatedAtUtc: new Date(),
    };
    const user = await User.findByIdAndUpdate(
      req.user.sub,
      { $set: { bankAccount: clean } },
      { new: true }
    );
    res.json({ success: true, data: toResponse(user) });
  } catch (error) {
    next(error);
  }
}

module.exports = { getMyBankAccount, upsertMyBankAccount };
