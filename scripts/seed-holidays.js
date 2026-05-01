const mongoose = require('mongoose');
const { connectDb } = require('../src/db/connect');
const { assertSeedingAllowed } = require('../src/utils/seed-guard');
const { HolidayCalendar } = require('../src/models');
const { logger } = require('../src/utils/logger');

const HOLIDAYS_2026 = [
  { dateIst: '2026-01-15', reason: 'Municipal Corporation Election - Maharashtra' },
  { dateIst: '2026-01-26', reason: 'Republic Day' },
  { dateIst: '2026-03-03', reason: 'Holi' },
  { dateIst: '2026-03-26', reason: 'Shri Ram Navami' },
  { dateIst: '2026-03-31', reason: 'Shri Mahavir Jayanti' },
  { dateIst: '2026-04-03', reason: 'Good Friday' },
  { dateIst: '2026-04-14', reason: 'Dr. Baba Saheb Ambedkar Jayanti' },
  { dateIst: '2026-05-01', reason: 'Maharashtra Day' },
  { dateIst: '2026-05-28', reason: 'Bakri Id' },
  { dateIst: '2026-06-26', reason: 'Muharram' },
  { dateIst: '2026-09-14', reason: 'Ganesh Chaturthi' },
  { dateIst: '2026-10-02', reason: 'Mahatma Gandhi Jayanti' },
  { dateIst: '2026-10-20', reason: 'Dussehra' },
  { dateIst: '2026-11-10', reason: 'Diwali-Balipratipada' },
  { dateIst: '2026-11-24', reason: 'Prakash Gurpurb Sri Guru Nanak Dev' },
  { dateIst: '2026-12-25', reason: 'Christmas' },
];

async function seedHolidays(exchange = 'NSE') {
  let upserts = 0;
  for (const h of HOLIDAYS_2026) {
    await HolidayCalendar.findOneAndUpdate(
      { exchange, dateIst: h.dateIst },
      { $set: { exchange, dateIst: h.dateIst, reason: h.reason } },
      { upsert: true }
    );
    upserts += 1;
  }
  return upserts;
}

async function main() {
  assertSeedingAllowed();
  await connectDb();
  const upserts = await seedHolidays('NSE');
  logger.info({ exchange: 'NSE', rows: HOLIDAYS_2026.length, upserts }, '2026 holidays seeded');
}

main()
  .catch((err) => {
    logger.error({ err }, 'seed-holidays failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
