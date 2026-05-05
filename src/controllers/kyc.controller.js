const { User } = require('../models');
const { AppError } = require('../utils/errors');
const { getSignedDownloadUrl } = require('../services/cloudinary.service');
const { submitMyKyc, getMyKyc, adminListKyc, adminReviewKyc, pickAsset } = require('../services/kyc.service');

async function submitKyc(req, res, next) {
  try {
    const fileMap = req.files || {};
    const data = await submitMyKyc(req.user.sub, fileMap);
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function myKyc(req, res, next) {
  try {
    const data = await getMyKyc(req.user.sub);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function myKycDocument(req, res, next) {
  try {
    const kind = req.validated.params.kind;
    const user = await User.findById(req.user.sub).select('kyc');
    if (!user) throw new AppError(404, 'User not found');
    const asset = pickAsset(user, kind);
    if (!asset?.publicId) throw new AppError(404, 'Document not found');
    const signedUrl = getSignedDownloadUrl(asset);
    const upstream = await fetch(signedUrl);
    if (!upstream.ok) throw new AppError(502, 'Unable to fetch document');
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await upstream.arrayBuffer();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.end(Buffer.from(arrayBuffer));
  } catch (error) {
    next(error);
  }
}

async function adminKycList(req, res, next) {
  try {
    const { data, meta } = await adminListKyc(req);
    res.json({ success: true, data, meta });
  } catch (error) {
    next(error);
  }
}

async function adminKycReview(req, res, next) {
  try {
    const { status, reason } = req.validated.body;
    const data = await adminReviewKyc(req.user.sub, req.validated.params.userCode, status, reason);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function adminKycDocument(req, res, next) {
  try {
    const { userCode, kind } = req.validated.params;
    const code = String(userCode).trim().toUpperCase();
    const user = await User.findOne({ userCode: code }).select('kyc');
    if (!user) throw new AppError(404, 'User not found');
    const asset = pickAsset(user, kind);
    if (!asset?.publicId) throw new AppError(404, 'Document not found');
    const signedUrl = getSignedDownloadUrl(asset);
    const upstream = await fetch(signedUrl);
    if (!upstream.ok) throw new AppError(502, 'Unable to fetch document');
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await upstream.arrayBuffer();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.end(Buffer.from(arrayBuffer));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  submitKyc,
  myKyc,
  myKycDocument,
  adminKycList,
  adminKycReview,
  adminKycDocument,
};
