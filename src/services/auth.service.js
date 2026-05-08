const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Wallet } = require('../models');
const { placeUserInTree } = require('./tree.service');
const { env } = require('../config/env');
const { ROLES } = require('../constants/roles');
const { AppError } = require('../utils/errors');
const { encryptPassword } = require('../utils/password-cipher');
const { createNumericPublicId } = require('../utils/public-id');

const NUMERIC_CODE_LENGTH = 5;

async function generateUniqueReferralCode() {
  let code = createNumericPublicId(NUMERIC_CODE_LENGTH);
  while (await User.findOne({ referralCode: code })) {
    code = createNumericPublicId(NUMERIC_CODE_LENGTH);
  }
  return code;
}

async function generateUniqueUserCode() {
  let code = createNumericPublicId(NUMERIC_CODE_LENGTH);
  while (await User.findOne({ userCode: code })) {
    code = createNumericPublicId(NUMERIC_CODE_LENGTH);
  }
  return code;
}

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role, email: user.email }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}

async function registerUser(input) {
  const existing = await User.findOne({ email: input.email.toLowerCase() });
  if (existing) throw new AppError(409, 'Email already exists');

  const normalizedReferral = String(input.referralCode || '').trim().toUpperCase();
  const referredByUser = await User.findOne({ referralCode: normalizedReferral });
  if (!referredByUser) throw new AppError(400, 'Invalid referral code');

  const passwordHash = await bcrypt.hash(input.password, 10);
  let passwordCipher;
  try {
    passwordCipher = encryptPassword(input.password);
  } catch {
    throw new AppError(500, 'Server misconfiguration: set PASSWORD_CIPHER_KEY (64 hex chars) in environment');
  }
  const referralCode = await generateUniqueReferralCode();
  const userCode = await generateUniqueUserCode();

  const user = await User.create({
    name: input.name,
    email: input.email.toLowerCase(),
    passwordHash,
    passwordCipher,
    mobileNumber: String(input.mobileNumber || '').trim(),
    userCode,
    referralCode,
    referredBy: referredByUser._id,
    preferredCommunity: input.community,
    role: ROLES.USER,
  });

  await Wallet.create({ userId: user._id, balance: 0, eligibleToWithdraw: 0 });
  await placeUserInTree(user._id, input.community);
  await User.updateOne({ _id: user._id }, { $set: { treePlacedAt: new Date() } });

  return { user, token: signToken(user) };
}

async function loginUser(email, password) {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) throw new AppError(401, 'Invalid credentials');
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new AppError(401, 'Invalid credentials');
  if (!user.userCode) {
    user.userCode = await generateUniqueUserCode();
    await user.save();
  }
  return { user, token: signToken(user) };
}

async function changePassword(userId, currentPassword, newPassword) {
  const user = await User.findById(userId).select('passwordHash passwordCipher');
  if (!user) throw new AppError(404, 'User not found');
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) throw new AppError(400, 'Current password is incorrect');
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  try {
    user.passwordCipher = encryptPassword(newPassword);
  } catch {
    throw new AppError(500, 'Server misconfiguration: set PASSWORD_CIPHER_KEY (64 hex chars) in environment');
  }
  await user.save();
}

async function bootstrapAdmin() {
  const admin = await User.findOne({ role: ROLES.ADMIN });
  if (admin) return;

  const referralCode = await generateUniqueReferralCode();
  const userCode = await generateUniqueUserCode();
  const passwordHash = await bcrypt.hash(env.seedSharedPassword, 10);
  let passwordCipher = null;
  try {
    passwordCipher = encryptPassword(env.seedSharedPassword);
  } catch {
    /* seed may run before PASSWORD_CIPHER_KEY is set */
  }
  const created = await User.create({
    name: 'System Admin',
    email: env.adminBootstrapEmail.toLowerCase(),
    passwordHash,
    passwordCipher,
    mobileNumber: '0000000000',
    role: ROLES.ADMIN,
    userCode,
    referralCode,
    referredBy: null,
    preferredCommunity: 'left',
  });
  await Wallet.create({ userId: created._id, balance: 0, eligibleToWithdraw: 0 });
  await placeUserInTree(created._id, 'left');
  await User.updateOne({ _id: created._id }, { $set: { treePlacedAt: new Date() } });
}

/** Idempotent: creates the default main user under the seeded admin if missing. */
async function ensureSeedMainUser() {
  const email = env.seedUserEmail.toLowerCase();
  if (await User.findOne({ email })) return;

  const admin = await User.findOne({ role: ROLES.ADMIN });
  if (!admin) {
    throw new Error('Cannot seed main user: no admin exists. Run bootstrapAdmin first.');
  }

  await registerUser({
    name: env.seedUserName,
    email,
    password: env.seedSharedPassword,
    mobileNumber: '0000000000',
    referralCode: admin.referralCode,
    community: 'right',
  });
}

/**
 * Sets password for seeded admin + main user emails to `env.seedSharedPassword`.
 * Run from `npm run seed` so re-seeding matches `.env` even when accounts already existed.
 */
async function findReferrerByReferralCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  return User.findOne({ referralCode: c }).select('name userCode').lean();
}

async function syncSeedUserPasswords() {
  const emails = [env.adminBootstrapEmail.toLowerCase(), env.seedUserEmail.toLowerCase()];
  const passwordHash = await bcrypt.hash(env.seedSharedPassword, 10);
  let passwordCipher = null;
  try {
    passwordCipher = encryptPassword(env.seedSharedPassword);
  } catch {
    /* optional during seed if key missing */
  }
  const set = passwordCipher ? { passwordHash, passwordCipher } : { passwordHash };
  const result = await User.updateMany({ email: { $in: emails } }, { $set: set });
  return result.modifiedCount;
}

module.exports = {
  registerUser,
  loginUser,
  changePassword,
  bootstrapAdmin,
  ensureSeedMainUser,
  syncSeedUserPasswords,
  findReferrerByReferralCode,
};
