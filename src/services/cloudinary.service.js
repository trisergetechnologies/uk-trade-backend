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
  getSignedDownloadUrl,
};
