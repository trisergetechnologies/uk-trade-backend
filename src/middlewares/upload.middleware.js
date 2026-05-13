const multer = require('multer');
const { AppError } = require('../utils/errors');

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!String(file.mimetype || '').startsWith('image/')) {
      cb(new AppError(400, 'Only image files are allowed'));
      return;
    }
    cb(null, true);
  },
});

const uploadKyc = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE_BYTES, files: 2 },
  fileFilter: (req, file, cb) => {
    if (!String(file.mimetype || '').startsWith('image/')) {
      cb(new AppError(400, 'Only image files are allowed'));
      return;
    }
    cb(null, true);
  },
});

module.exports = { upload, uploadKyc, MAX_IMAGE_SIZE_BYTES };
