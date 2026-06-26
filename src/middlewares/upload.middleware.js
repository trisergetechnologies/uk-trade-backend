const multer = require('multer');
const { AppError } = require('../utils/errors');

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i;

function isAllowedImageUpload(file) {
  const mime = String(file.mimetype || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  if (mime === 'application/octet-stream' && IMAGE_EXT_RE.test(String(file.originalname || ''))) {
    return true;
  }
  return IMAGE_EXT_RE.test(String(file.originalname || ''));
}

function imageFileFilter(req, file, cb) {
  if (!isAllowedImageUpload(file)) {
    cb(new AppError(400, 'Only image files are allowed (JPG, PNG, WEBP, HEIC)'));
    return;
  }
  cb(null, true);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE_BYTES, files: 1 },
  fileFilter: imageFileFilter,
});

const uploadKyc = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE_BYTES, files: 2 },
  fileFilter: imageFileFilter,
});

/** Ensures multer errors reach Express error handler (required for Express 5). */
function wrapMulter(middleware) {
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (err) return next(err);
      return next();
    });
  };
}

module.exports = { upload, uploadKyc, wrapMulter, MAX_IMAGE_SIZE_BYTES, isAllowedImageUpload };
