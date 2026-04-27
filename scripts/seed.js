/**
 * One-off DB seed: default plans + bootstrap admin (if missing) + main user (if missing).
 * Run after Mongo is up: `npm run seed`
 */
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const { connectDb } = require('../src/db/connect');
const { bootstrapAdmin, ensureSeedMainUser, syncSeedUserPasswords } = require('../src/services/auth.service');
const { seedDefaultPlans } = require('../src/services/plan.service');
const { HolidayCalendar } = require('../src/models');
const { logger } = require('../src/utils/logger');

async function main() {
  await connectDb();
  await seedDefaultPlans();
  const holidays2026 = [
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
  for (const h of holidays2026) {
    await HolidayCalendar.findOneAndUpdate(
      { exchange: 'NSE', dateIst: h.dateIst },
      { $set: { exchange: 'NSE', dateIst: h.dateIst, reason: h.reason } },
      { upsert: true }
    );
  }
  await bootstrapAdmin();
  await ensureSeedMainUser();
  const passwordRowsUpdated = await syncSeedUserPasswords();
  logger.info(
    {
      adminEmail: env.adminBootstrapEmail,
      mainUserEmail: env.seedUserEmail,
      passwordRowsUpdated,
      passwordNote:
        'Passwords for admin + main user emails were synced to SEED_SHARED_PASSWORD / ADMIN_BOOTSTRAP_PASSWORD (default UkTrade@Dev123).',
    },
    'Seed completed — use admin + main user emails with the shared password from .env'
  );
}

main()
  .catch((err) => {
    logger.error({ err }, 'Seed failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });

