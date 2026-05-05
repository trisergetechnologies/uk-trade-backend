const { registerUser, loginUser, changePassword, findReferrerByReferralCode } = require('../services/auth.service');
const { User } = require('../models');
const { AppError } = require('../utils/errors');

function publicUser(userDoc) {
  if (!userDoc) return null;
  const u = userDoc.toObject ? userDoc.toObject() : userDoc;
  return {
    id: u.userCode || ((u._id && u._id.toString()) || u.sub),
    userCode: u.userCode,
    name: u.name,
    email: u.email,
    role: u.role,
    referralCode: u.referralCode,
    preferredCommunity: u.preferredCommunity,
    kycStatus: u.kyc?.status || 'unverified',
  };
}

async function register(req, res, next) {
  try {
    const { user, token } = await registerUser(req.validated.body);
    res.status(201).json({ success: true, data: { user: publicUser(user), token } });
  } catch (error) {
    next(error);
  }
}

async function login(req, res, next) {
  try {
    const { user, token } = await loginUser(req.validated.body.email, req.validated.body.password);
    res.json({ success: true, data: { user: publicUser(user), token } });
  } catch (error) {
    next(error);
  }
}

async function me(req, res, next) {
  try {
    const doc = await User.findById(req.user.sub).select('userCode name email role referralCode preferredCommunity kyc.status');
    if (!doc) return next(new AppError(404, 'User not found'));
    res.json({ success: true, data: publicUser(doc) });
  } catch (error) {
    next(error);
  }
}

async function updateMe(req, res, next) {
  try {
    const updates = {};
    if (typeof req.validated.body.name === 'string') updates.name = req.validated.body.name.trim();
    if (typeof req.validated.body.preferredCommunity === 'string') {
      updates.preferredCommunity = req.validated.body.preferredCommunity;
    }
    if (typeof req.validated.body.email === 'string') {
      const nextEmail = req.validated.body.email.trim().toLowerCase();
      const exists = await User.findOne({ email: nextEmail, _id: { $ne: req.user.sub } }).select('_id');
      if (exists) throw new AppError(409, 'Email already exists');
      updates.email = nextEmail;
    }
    if (!Object.keys(updates).length) {
      const current = await User.findById(req.user.sub).select(
        'userCode name email role referralCode preferredCommunity kyc.status'
      );
      if (!current) throw new AppError(404, 'User not found');
      return res.json({ success: true, data: publicUser(current) });
    }
    const doc = await User.findByIdAndUpdate(req.user.sub, { $set: updates }, { new: true }).select(
      'userCode name email role referralCode preferredCommunity kyc.status'
    );
    if (!doc) throw new AppError(404, 'User not found');
    res.json({ success: true, data: publicUser(doc) });
  } catch (error) {
    next(error);
  }
}

async function updateMyPassword(req, res, next) {
  try {
    await changePassword(req.user.sub, req.validated.body.currentPassword, req.validated.body.newPassword);
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    next(error);
  }
}

async function referrerLookup(req, res, next) {
  try {
    const code = String(req.validated.query.code || '').trim();
    const u = await findReferrerByReferralCode(code);
    if (!u) return next(new AppError(404, 'Referrer not found'));
    res.json({ success: true, data: { name: u.name, userCode: u.userCode } });
  } catch (error) {
    next(error);
  }
}

module.exports = { register, login, me, updateMe, updateMyPassword, referrerLookup };
