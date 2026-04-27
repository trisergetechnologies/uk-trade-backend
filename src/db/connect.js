const mongoose = require('mongoose');
const { env } = require('../config/env');
const { logger } = require('../utils/logger');

async function connectDb() {
  await mongoose.connect(env.mongoUri);
  logger.info({ mongoUri: env.mongoUri }, 'MongoDB connected');
}

module.exports = { connectDb };
