const app = require('./app');
const { env } = require('./config/env');
const { connectDb } = require('./db/connect');
const { startSchedulers } = require('./jobs/scheduler');
const { logger } = require('./utils/logger');

async function start() {
  await connectDb();
  startSchedulers();

  app.listen(env.port, () => {
    logger.info({ port: env.port }, 'Backend server started');
  });
}

start().catch((error) => {
  logger.error({ err: error }, 'Failed to start backend');
  process.exit(1);
});
