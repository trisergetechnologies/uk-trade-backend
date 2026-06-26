const multer = require('multer');
const { AppError } = require('../utils/errors');
const { MAX_IMAGE_SIZE_BYTES } = require('./upload.middleware');

function normalizeUploadError(err) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return new AppError(
        400,
        `File too large (max ${Math.round(MAX_IMAGE_SIZE_BYTES / (1024 * 1024))}MB per image)`
      );
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return new AppError(400, 'Too many files or unexpected field name for upload');
    }
    return new AppError(400, err.message || 'Upload failed');
  }
  return err;
}

function notFoundHandler(req, res, next) {
  next(new AppError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

function errorHandler(err, req, res, next) {
  const normalized = normalizeUploadError(err);
  const statusCode = normalized.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: normalized.message || 'Internal server error',
    details: normalized.details || null,
  });
}

module.exports = { notFoundHandler, errorHandler };
