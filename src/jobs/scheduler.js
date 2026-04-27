const { runDailyTradeCredits } = require('../services/trade.service');
const { logger } = require('../utils/logger');

/** Hourly tick: trade credits are idempotent per package+IST day; TradeJobRun prevents duplicate full runs. */
function startSchedulers() {
  setInterval(async () => {
    try {
      const result = await runDailyTradeCredits();
      logger.info({ result }, 'Daily trade scheduler tick');
    } catch (error) {
      logger.error({ err: error }, 'Daily trade scheduler failed');
    }
  }, 1000 * 60 * 60);
}

module.exports = { startSchedulers };
