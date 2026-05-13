const { v2: cloudinary } = require('cloudinary');
const { env } = require('../config/env');
const { AppError } = require('../utils/errors');

const isConfigured = Boolean(env.cloudinaryCloudName && env.cloudinaryApiKey && env.cloudinaryApiSecret);

if (isConfigured) {
  cloudinary.config({
    cloud_name: env.cloudinaryCloudName,
    api_key: env.cloudinaryApiKey,
    api_secret: env.cloudinaryApiSecret,
    secure: true,
  });
}

function assertConfigured() {
  if (!isConfigured) {
    throw new AppError(500, 'Cloudinary is not configured');
  }
}

async function uploadPaymentProof(fileBuffer, filename) {
  assertConfigured();
  const dataUri = `data:image/${String(filename || 'png').split('.').pop()};base64,${fileBuffer.toString('base64')}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    folder: `${env.cloudinaryFolder}/payment-proofs`,
    resource_type: 'image',
    type: 'private',
    overwrite: false,
  });
  return {
    publicId: result.public_id,
    resourceType: result.resource_type || 'image',
    format: result.format || 'jpg',
  };
}

/** @param {string} docKind folder segment under kyc/ */
async function uploadKycDocument(fileBuffer, filename, docKind) {
  assertConfigured();
  const ext = String(filename || 'png').split('.').pop() || 'jpg';
  const dataUri = `data:image/${ext};base64,${fileBuffer.toString('base64')}`;
  const safeKind = String(docKind || 'doc').replace(/[^a-z]/gi, '');
  try {
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: `${env.cloudinaryFolder}/kyc/${safeKind}`,
      resource_type: 'image',
      type: 'private',
      overwrite: false,
    });
    return {
      publicId: result.public_id,
      resourceType: result.resource_type || 'image',
      format: result.format || 'jpg',
    };
  } catch (err) {
    const http = err && typeof err.http_code === 'number' ? err.http_code : null;
    const raw = err && err.message ? String(err.message) : String(err);
    const short = raw.length > 180 ? `${raw.slice(0, 180)}…` : raw;
    throw new AppError(
      502,
      http
        ? `Could not upload image to storage (HTTP ${http}). Try a smaller file or JPG/PNG.`
        : `Could not upload image: ${short}`
    );
  }
}

function getSignedDownloadUrl({ publicId, resourceType, format }) {
  assertConfigured();
  return cloudinary.utils.private_download_url(publicId, format || 'jpg', {
    resource_type: resourceType || 'image',
    type: 'private',
    expires_at: Math.floor(Date.now() / 1000) + 120,
    attachment: false,
  });
}

module.exports = {
  uploadPaymentProof,
  uploadKycDocument,
  getSignedDownloadUrl,
};
