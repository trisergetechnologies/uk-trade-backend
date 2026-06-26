const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { v2: cloudinary } = require('cloudinary');
const { env } = require('../config/env');
const { AppError } = require('../utils/errors');
const { logger } = require('../utils/logger');

const isConfigured = Boolean(env.cloudinaryCloudName && env.cloudinaryApiKey && env.cloudinaryApiSecret);
const LOCAL_ID_PREFIX = 'local:kyc/';
const LOCAL_UPLOAD_ROOT = path.resolve(process.env.KYC_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'kyc'));

if (isConfigured) {
  cloudinary.config({
    cloud_name: env.cloudinaryCloudName,
    api_key: env.cloudinaryApiKey,
    api_secret: env.cloudinaryApiSecret,
    secure: true,
  });
} else {
  logger.warn('Cloudinary is not configured — KYC documents will be stored on local disk until credentials are set');
}

function resolveImageExt(filename, mimetype) {
  const byMime = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/bmp': 'bmp',
  };
  const mt = String(mimetype || '').toLowerCase();
  if (byMime[mt]) return byMime[mt];
  const ext = String(filename || '')
    .split('.')
    .pop()
    ?.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'bmp'].includes(ext || '')) {
    return ext === 'jpeg' ? 'jpg' : ext;
  }
  return 'jpg';
}

function isLocalAsset(publicId) {
  return String(publicId || '').startsWith(LOCAL_ID_PREFIX);
}

function assertConfigured() {
  if (!isConfigured) {
    throw new AppError(500, 'Cloudinary is not configured');
  }
}

async function uploadKycDocumentLocal(fileBuffer, filename, docKind, mimetype) {
  const ext = resolveImageExt(filename, mimetype);
  const safeKind = String(docKind || 'doc').replace(/[^a-z]/gi, '');
  const dir = path.join(LOCAL_UPLOAD_ROOT, safeKind);
  await fs.mkdir(dir, { recursive: true });
  const id = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const relPath = path.posix.join(safeKind, id);
  await fs.writeFile(path.join(LOCAL_UPLOAD_ROOT, relPath), fileBuffer);
  return {
    publicId: `${LOCAL_ID_PREFIX}${relPath}`,
    resourceType: 'image',
    format: ext,
  };
}

async function readLocalKycDocument(asset) {
  const rel = String(asset.publicId).slice(LOCAL_ID_PREFIX.length);
  const abs = path.join(LOCAL_UPLOAD_ROOT, rel);
  const buffer = await fs.readFile(abs);
  const ext = asset.format || path.extname(rel).slice(1) || 'jpg';
  const contentType =
    ext === 'png'
      ? 'image/png'
      : ext === 'webp'
        ? 'image/webp'
        : ext === 'gif'
          ? 'image/gif'
          : ext === 'heic' || ext === 'heif'
            ? `image/${ext}`
            : 'image/jpeg';
  return { buffer, contentType };
}

async function uploadPaymentProof(fileBuffer, filename, mimetype) {
  assertConfigured();
  const ext = resolveImageExt(filename, mimetype);
  const dataUri = `data:image/${ext};base64,${fileBuffer.toString('base64')}`;
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
async function uploadKycDocument(fileBuffer, filename, docKind, mimetype) {
  if (!isConfigured) {
    return uploadKycDocumentLocal(fileBuffer, filename, docKind, mimetype);
  }

  const ext = resolveImageExt(filename, mimetype);
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

async function fetchKycDocument(asset) {
  if (!asset?.publicId) throw new AppError(404, 'Document not found');
  if (isLocalAsset(asset.publicId)) {
    try {
      return await readLocalKycDocument(asset);
    } catch (err) {
      if (err && err.code === 'ENOENT') throw new AppError(404, 'Document file not found on server');
      throw err;
    }
  }
  const signedUrl = getSignedDownloadUrl(asset);
  const upstream = await fetch(signedUrl);
  if (!upstream.ok) {
    throw new AppError(
      502,
      `Document could not be loaded from storage (upstream HTTP ${upstream.status}). Try again in a moment.`
    );
  }
  const contentType = upstream.headers.get('content-type') || 'image/jpeg';
  const arrayBuffer = await upstream.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

module.exports = {
  uploadPaymentProof,
  uploadKycDocument,
  getSignedDownloadUrl,
  fetchKycDocument,
  isLocalAsset,
  isConfigured,
};
