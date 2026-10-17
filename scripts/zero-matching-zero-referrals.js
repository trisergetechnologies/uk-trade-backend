/**
 * Zero matching income for users who were credited it with 0 personal direct referrals.
 *
 * A personal direct referral is a user whose referredBy is this earner (role user).
 * Level-1 spillover children do not count.
 *
 * For each such earner this script:
 *   1. Archives the matching events and matching_income ledger credits
 *   2. Marks those events skipped and sets payoutCreditedAmount to 0
 *   3. Deletes the matching_income wallet credits and reduces wallet balance by that sum
 *   4. Resets firstMatchingDone and matchingMatchedVolume
 *   5. Recalculates eligibleToWithdraw (no auto-withdrawal)
 *
 * Users with 1 or more personal referrals are left unchanged.
 *
 * Dry-run (default, no writes):
 *   node scripts/zero-matching-zero-referrals.js
 *
 * Apply (API should be stopped):
 *   PROD_PROTECT=false ZERO_MATCHING_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP ^
 *     ALLOW_PRODUCTION_DB=true node scripts/zero-matching-zero-referrals.js --apply
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const { connectDb } = require('../src/db/connect');
const { User, Wallet, WalletLedger, MatchingIncomeEvent } = require('../src/models');
const { ROLES } = require('../src/constants/roles');
const { recalculateEligibility } = require('../src/services/eligibility.service');
const { logger } = require('../src/utils/logger');

const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY;

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

function parseMongoDbName(uri) {
  const withoutQuery = String(uri || '').split('?')[0];
  const slash = withoutQuery.lastIndexOf('/');
  if (slash < 0 || slash === withoutQuery.length - 1) return '';
  return withoutQuery.slice(slash + 1);
}

function assertApplyAllowed() {
  if (DRY_RUN) return;
  if (env.prodProtectBlocksSeeding) {
    throw new Error('Apply blocked: set PROD_PROTECT=false in the environment.');
  }
  const confirm = String(process.env.ZERO_MATCHING_CONFIRM || '').trim();
  if (confirm !== 'YES_I_HAVE_A_DATABASE_BACKUP') {
    throw new Error(
      'Apply blocked: set ZERO_MATCHING_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP after a full MongoDB backup.'
    );
  }
  const dbName = parseMongoDbName(env.mongoUri);
  if (dbName === 'uk_trade' && String(process.env.ALLOW_PRODUCTION_DB || '').trim() !== 'true') {
    throw new Error('Refusing to apply on database "uk_trade" without ALLOW_PRODUCTION_DB=true.');
  }
}

async function loadTargets() {
  const grouped = await MatchingIncomeEvent.aggregate([
    { $match: { status: 'credited', payoutCreditedAmount: { $gt: 0 } } },
    {
      $group: {
        _id: '$earnerUserId',
        matchingCredits: { $sum: 1 },
        matchingAmount: { $sum: '$payoutCreditedAmount' },
      },
    },
  ]);

  const targets = [];
  for (const row of grouped) {
    const directReferralCount = await User.countDocuments({
      referredBy: row._id,
      role: ROLES.USER,
    });
    if (directReferralCount !== 0) continue;

    const user = await User.findById(row._id).select('userCode name email firstMatchingDone matchingMatchedVolume').lean();
    if (!user) continue;

    const events = await MatchingIncomeEvent.find({
      earnerUserId: row._id,
      status: 'credited',
      payoutCreditedAmount: { $gt: 0 },
    }).lean();
    const ledger = await WalletLedger.find({
      userId: row._id,
      contextType: 'matching_income',
      direction: 'credit',
    }).lean();
    const wallet = await Wallet.findOne({ userId: row._id }).select('balance eligibleToWithdraw').lean();

    const eventTotal = round2(events.reduce((s, e) => s + Number(e.payoutCreditedAmount || 0), 0));
    const ledgerTotal = round2(ledger.reduce((s, e) => s + Number(e.amount || 0), 0));
    const balance = round2(wallet?.balance || 0);

    targets.push({
      userId: row._id,
      userCode: user.userCode,
      name: user.name,
      email: user.email,
      directReferralCount,
      matchingCredits: events.length,
      eventTotal,
      ledgerTotal,
      balanceBefore: balance,
      balanceAfter: round2(balance - ledgerTotal),
      eligibleBefore: round2(wallet?.eligibleToWithdraw || 0),
      firstMatchingDone: Boolean(user.firstMatchingDone),
      matchingMatchedVolume: round2(user.matchingMatchedVolume || 0),
      walletMissing: !wallet,
      events,
      ledger,
    });
  }

  targets.sort((a, b) => b.eventTotal - a.eventTotal);
  return targets;
}

async function archiveTargets(targets) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const archiveName = `matching_zero_referral_archive_${stamp}`;
  const docs = [];
  for (const target of targets) {
    for (const event of target.events) {
      docs.push({ kind: 'matching_event', userCode: target.userCode, userId: target.userId, doc: event, archivedAt: new Date() });
    }
    for (const entry of target.ledger) {
      docs.push({ kind: 'wallet_ledger', userCode: target.userCode, userId: target.userId, doc: entry, archivedAt: new Date() });
    }
  }
  if (docs.length) {
    await mongoose.connection.db.collection(archiveName).insertMany(docs);
  }
  return { archiveName, archivedCount: docs.length };
}

async function applyOne(target) {
  const nowIso = new Date().toISOString();
  if (target.events.length) {
    await MatchingIncomeEvent.bulkWrite(
      target.events.map((event) => ({
        updateOne: {
          filter: { _id: event._id, status: 'credited' },
          update: {
            $set: {
              status: 'skipped',
              reason: 'reversed-no-direct-referrals',
              payoutCreditedAmount: 0,
              metadata: {
                ...(event.metadata || {}),
                reversedAt: nowIso,
                reversedPayoutCreditedAmount: round2(event.payoutCreditedAmount),
                previousStatus: event.status,
                reverseReason: 'no-direct-referrals',
              },
            },
          },
        },
      }))
    );
  }

  if (target.ledger.length) {
    await WalletLedger.deleteMany({ _id: { $in: target.ledger.map((row) => row._id) } });
  }

  if (!target.walletMissing && target.ledgerTotal > 0) {
    await Wallet.updateOne({ userId: target.userId }, { $inc: { balance: -target.ledgerTotal } });
  }

  await User.updateOne(
    { _id: target.userId },
    { $set: { firstMatchingDone: false, matchingMatchedVolume: 0 } }
  );

  let eligibleAfter = null;
  if (!target.walletMissing) {
    const wallet = await recalculateEligibility(target.userId.toString(), null, { skipAutoWithdraw: true });
    eligibleAfter = round2(wallet.eligibleToWithdraw);
  }

  const walletAfter = await Wallet.findOne({ userId: target.userId }).select('balance eligibleToWithdraw').lean();
  const creditedLeft = await MatchingIncomeEvent.countDocuments({
    earnerUserId: target.userId,
    status: 'credited',
    payoutCreditedAmount: { $gt: 0 },
  });

  return {
    userCode: target.userCode,
    name: target.name,
    eventTotal: target.eventTotal,
    ledgerTotal: target.ledgerTotal,
    balanceBefore: target.balanceBefore,
    balanceAfter: round2(walletAfter?.balance || 0),
    eligibleBefore: target.eligibleBefore,
    eligibleAfter: eligibleAfter == null ? round2(walletAfter?.eligibleToWithdraw || 0) : eligibleAfter,
    creditedEventsLeft: creditedLeft,
  };
}

function printRows(rows) {
  for (const row of rows) {
    console.log(
      [
        String(row.userCode).padEnd(12),
        String(row.name || '').padEnd(22).slice(0, 22),
        `events ₹${row.eventTotal}`,
        `ledger ₹${row.ledgerTotal}`,
        `balance ${row.balanceBefore} -> ${row.balanceAfter}`,
        row.eligibleBefore != null ? `eligible ${row.eligibleBefore}${row.eligibleAfter != null ? ` -> ${row.eligibleAfter}` : ''}` : '',
      ]
        .filter(Boolean)
        .join(' | ')
    );
  }
}

async function main() {
  assertApplyAllowed();
  await connectDb();
  const dbName = parseMongoDbName(env.mongoUri);
  const targets = await loadTargets();
  const eventTotal = round2(targets.reduce((s, t) => s + t.eventTotal, 0));
  const ledgerTotal = round2(targets.reduce((s, t) => s + t.ledgerTotal, 0));
  const negative = targets.filter((t) => t.balanceAfter < -0.001);

  console.log(`\n=== ZERO MATCHING FOR 0 DIRECT REFERRALS ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'APPLY'}`);
  console.log(`Database: ${dbName}`);
  console.log(`Users: ${targets.length}`);
  console.log(`Matching events total: ₹${eventTotal}`);
  console.log(`Matching ledger total: ₹${ledgerTotal}`);
  console.log(`Wallets that would go negative: ${negative.length}`);
  printRows(targets);

  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  if (DRY_RUN) {
    const outFile = path.join(outDir, `zero-matching-zero-referrals-dry-run-${Date.now()}.json`);
    const report = targets.map(({ events, ledger, ...rest }) => rest);
    fs.writeFileSync(outFile, JSON.stringify({ dbName, users: targets.length, eventTotal, ledgerTotal, rows: report }, null, 2));
    console.log(`Report: ${outFile}`);
    console.log('Dry-run only. Re-run with --apply to zero these matching credits.');
    return;
  }

  const archive = await archiveTargets(targets);
  console.log(`Archive: ${archive.archiveName} (${archive.archivedCount} docs)`);

  const applied = [];
  for (const target of targets) {
    const result = await applyOne(target);
    applied.push(result);
    console.log(
      `zeroed ${result.userCode} | balance ${result.balanceBefore} -> ${result.balanceAfter} | eligible ${result.eligibleBefore} -> ${result.eligibleAfter} | credited left ${result.creditedEventsLeft}`
    );
  }

  const outFile = path.join(outDir, `zero-matching-zero-referrals-applied-${Date.now()}.json`);
  fs.writeFileSync(
    outFile,
    JSON.stringify({ dbName, archive, users: applied.length, eventTotal, ledgerTotal, rows: applied }, null, 2)
  );
  console.log(`Report: ${outFile}`);
  logger.info({ users: applied.length, eventTotal, ledgerTotal, archive: archive.archiveName }, 'zero-matching-zero-referrals applied');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'zero-matching-zero-referrals failed');
    console.error(err);
    process.exit(1);
  });
