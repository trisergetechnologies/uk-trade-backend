const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const pinoHttp = require('pino-http');

const routes = require('./routes');
const { logger } = require('./utils/logger');
const { notFoundHandler, errorHandler } = require('./middlewares/error.middleware');
const { sanitizeApiResponses } = require('./middlewares/response-sanitize.middleware');
const { createCorsMiddleware } = require('./middlewares/cors.middleware');

const app = express();

app.use(createCorsMiddleware());
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));
app.use(pinoHttp({ logger }));
app.use(sanitizeApiResponses);

app.use('/api', routes);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
