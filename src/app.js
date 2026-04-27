const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const pinoHttp = require('pino-http');

const routes = require('./routes');
const { logger } = require('./utils/logger');
const { notFoundHandler, errorHandler } = require('./middlewares/error.middleware');
const { sanitizeApiResponses } = require('./middlewares/response-sanitize.middleware');

const app = express();

app.use(cors());
app.use(helmet());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));
app.use(pinoHttp({ logger }));
app.use(sanitizeApiResponses);

app.use('/api', routes);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
