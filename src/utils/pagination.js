function parsePagination(req) {
  const page = Math.max(1, Number.parseInt(String(req.query.page), 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit), 10) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

function metaFor(page, limit, total) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) || 1 };
}

module.exports = { parsePagination, metaFor };
