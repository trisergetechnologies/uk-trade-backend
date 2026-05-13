const { User, AuditLog } = require('../models');
const { AppError } = require('../utils/errors');
const { uploadKycDocument } = require('./cloudinary.service');
const { parsePagination, metaFor } = require('../utils/pagination');

/** URL param values for GET document routes (includes legacy submissions). */
const KYC_KINDS = ['aadhaar', 'passbook', 'aadhaarFront', 'aadhaarBack', 'pan', 'photo'];

function kycDocumentKindsFromKyc(k) {
  if (!k) return [];
  const kinds = [];
  if (k.aadhaarAsset?.publicId) kinds.push('aadhaar');
  else {
    if (k.aadhaarFrontAsset?.publicId) kinds.push('aadhaarFront');
    if (k.aadhaarBackAsset?.publicId) kinds.push('aadhaarBack');
  }
  if (k.passbookAsset?.publicId) kinds.push('passbook');
  if (k.panAsset?.publicId) kinds.push('pan');
  if (k.photoAsset?.publicId) kinds.push('photo');
  return kinds;
}

function kycSummary(user) {
  const k = user.kyc || {};
  return {
    status: k.status || 'unverified',
    submittedAt: k.submittedAt || null,
    reviewedAt: k.reviewedAt || null,
    reviewReason: k.reviewReason || '',
    documents: kycDocumentKindsFromKyc(k),
  };
}

function pickAsset(user, kind) {
  const k = user.kyc || {};
  if (kind === 'aadhaar') return k.aadhaarAsset;
  if (kind === 'passbook') return k.passbookAsset;
  if (kind === 'aadhaarFront') return k.aadhaarFrontAsset;
  if (kind === 'aadhaarBack') return k.aadhaarBackAsset;
  if (kind === 'pan') return k.panAsset;
  if (kind === 'photo') return k.photoAsset;
  return null;
}

async function submitMyKyc(userId, fileMap, bankInput = {}) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'User not found');

  const current = user.kyc?.status || 'unverified';
  if (current === 'approved') {
    throw new AppError(400, 'KYC is already approved');
  }

  const accountHolderName = String(bankInput.accountHolderName || '').trim();
  const bankName = String(bankInput.bankName || '').trim();
  const accountNumber = String(bankInput.accountNumber || '').trim();
  const ifscCode = String(bankInput.ifscCode || '').trim().toUpperCase();
  const upiId = String(bankInput.upiId || '').trim().toLowerCase();
  if (!accountHolderName || !bankName || !accountNumber || !ifscCode) {
    throw new AppError(400, 'Bank account holder, bank name, account number and IFSC are required');
  }

  const aadhaar = fileMap.aadhaar?.[0];
  const passbook = fileMap.passbook?.[0];
  if (!aadhaar?.buffer || !passbook?.buffer) {
    throw new AppError(400, 'Aadhaar image and passbook or cheque book image are required');
  }

  const [aadhaarAsset, passbookAsset] = await Promise.all([
    uploadKycDocument(aadhaar.buffer, aadhaar.originalname, 'aadhaar'),
    uploadKycDocument(passbook.buffer, passbook.originalname, 'passbook'),
  ]);

  user.kyc = {
    status: 'pending',
    aadhaarAsset,
    passbookAsset,
    submittedAt: new Date(),
    reviewedBy: null,
    reviewReason: '',
    reviewedAt: null,
  };
  user.bankAccount = {
    accountHolderName,
    bankName,
    accountNumber,
    ifscCode,
    upiId,
    updatedAtUtc: new Date(),
  };
  await user.save();

  await AuditLog.create({
    actorUserId: userId,
    action: 'kyc_submitted',
    targetType: 'User',
    targetId: user._id,
    details: { status: 'pending', bankUpdated: true },
  });

  return kycSummary(user);
}

async function getMyKyc(userId) {
  const user = await User.findById(userId).select('kyc');
  if (!user) throw new AppError(404, 'User not found');
  return kycSummary(user);
}

async function adminListKyc(req) {
  const { page, limit, skip } = parsePagination(req);
  const statusRaw = String(req.query.status || 'pending').toLowerCase();
  const q = String(req.query.q || '').trim();

  const filter = {};
  if (statusRaw !== 'all') {
    if (statusRaw === 'unverified') {
      filter.$or = [{ 'kyc.status': 'unverified' }, { kyc: { $exists: false } }];
    } else if (['pending', 'approved', 'rejected'].includes(statusRaw)) {
      filter['kyc.status'] = statusRaw;
    } else {
      filter['kyc.status'] = 'pending';
    }
  }

  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    const searchCond = { $or: [{ name: rx }, { email: rx }, { userCode: rx }] };
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, searchCond];
      delete filter.$or;
    } else {
      Object.assign(filter, searchCond);
    }
  }

  const [list, total] = await Promise.all([
    User.find(filter)
      .select('name email userCode kyc createdAt')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  const data = list.map((row) => ({
    userCode: row.userCode,
    name: row.name,
    email: row.email,
    kyc: kycSummary({ kyc: row.kyc }),
    createdAt: row.createdAt,
  }));

  return { data, meta: metaFor(page, limit, total) };
}

async function adminReviewKyc(adminUserId, userCode, status, reason) {
  const code = String(userCode || '').trim().toUpperCase();
  const user = await User.findOne({ userCode: code });
  if (!user) throw new AppError(404, 'User not found');
  if (user.kyc?.status !== 'pending') {
    throw new AppError(400, 'This user has no pending KYC submission');
  }

  user.kyc.status = status;
  user.kyc.reviewedBy = adminUserId;
  user.kyc.reviewReason = reason || '';
  user.kyc.reviewedAt = new Date();
  await user.save();

  await AuditLog.create({
    actorUserId: adminUserId,
    action: 'kyc_reviewed',
    targetType: 'User',
    targetId: user._id,
    details: { userCode: code, status, reason },
  });

  return { userCode: user.userCode, name: user.name, email: user.email, kyc: kycSummary(user) };
}

function assertKycApproved(user) {
  const st = user.kyc?.status || 'unverified';
  if (st !== 'approved') {
    throw new AppError(
      400,
      'Complete KYC (Aadhaar and passbook or cheque book upload) and wait for admin approval before withdrawing'
    );
  }
}

module.exports = {
  KYC_KINDS,
  kycSummary,
  pickAsset,
  submitMyKyc,
  getMyKyc,
  adminListKyc,
  adminReviewKyc,
  assertKycApproved,
};
