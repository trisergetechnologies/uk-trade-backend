const OBJECT_ID_HEX = /^[a-f\d]{24}$/i;

function isPlainObject(value) {
  if (Object.prototype.toString.call(value) !== '[object Object]') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  if (value && value._bsontype === 'ObjectId') return value.toString();

  if (value instanceof Date) return value;
  if (!isPlainObject(value) && !value.toObject) return value;
  const src = isPlainObject(value) ? value : value.toObject();
  if (src && isPlainObject(src._doc)) {
    return sanitize(src._doc);
  }
  const out = {};

  if (src.userCode) out.id = String(src.userCode);
  else if (src.publicId) out.id = String(src.publicId);
  else if (src.code && typeof src.code === 'string') out.id = src.code;
  else if (src._id != null) out.id = String(src._id);

  for (const [key, raw] of Object.entries(src)) {
    if (key === '_id' || key === '__v' || key === 'publicId' || key.startsWith('$')) continue;
    if (
      key.endsWith('Id') &&
      ((typeof raw === 'string' && OBJECT_ID_HEX.test(raw)) || (raw && raw._bsontype === 'ObjectId'))
    ) {
      continue;
    }
    out[key] = sanitize(raw);
  }
  return out;
}

function sanitizeApiResponses(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (payload) => originalJson(sanitize(payload));
  next();
}

module.exports = { sanitizeApiResponses };
