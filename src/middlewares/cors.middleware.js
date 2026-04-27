const cors = require('cors');
const { env } = require('../config/env');

function createCorsMiddleware() {
  return cors({
    origin(origin, callback) {
      if (env.corsAllowAll) {
        callback(null, true);
        return;
      }
      if (!origin) {
        callback(null, true);
        return;
      }
      if (env.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  });
}

module.exports = { createCorsMiddleware };
