/**
 * Re-run matching for purchase(s) miscomputed with zero leg volumes (null asOfUtc bug).
 *
 * Flags:
 *   --dry-run
 *   --subscription-public-id SUBDREL8T7EVD
 *   --buyer-user-code 80928
 *   --repair-all-null-asof-skips   — every skipped event with L=0,R=0 and matched>0
 *
 * Example:
 *   PROD_PROTECT=false node scripts/reprocess-matching-subscription.js --buyer-user-code 80928 --dry-run
 *   PROD_PROTECT=false node scripts/reprocess-matching-subscription.js --buyer-user-code 80928
 */

require('dotenv').config();
const { connectDb } = require('../src/db/connect');
const { User, PackageSubscription, MatchingIncomeEvent } = require('../src/models');
const { reprocessMatchingForSubscription } = require('../src/services/matching.service');
const { logger } = require('../src/utils/logger');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const REPAIR_ALL = args.includes('--repair-all-null-asof-skips');

function readArg(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? String(args[i + 1] || '').trim() : '';
}

async function resolveSubscriptionIds() {
  if (REPAIR_ALL) {
    const rows = await MatchingIncomeEvent.aggregate([
      {
        $match: {
          status: 'skipped',
          reason: 'zero-considerable',
          leftVolumeBefore: 0,
          rightVolumeBefore: 0,
          matchedVolumeBefore: { $gt: 0 },
        },
      },
      { $group: { _id: '$triggerPurchaseSubscriptionId' } },
    ]);
    return rows.map((r) => r._id);
  }

  const publicId = readArg('--subscription-public-id');
  if (publicId) {
    const sub = await PackageSubscription.findOne({ publicId }).select('_id').lean();
    if (!sub) throw new Error(`Subscription not found: ${publicId}`);
    return [sub._id];
  }

  const userCode = readArg('--buyer-user-code').toUpperCase();
  if (userCode) {
    const user = await User.findOne({ userCode }).select('_id').lean();
    if (!user) throw new Error(`User not found: ${userCode}`);
    const subs = await PackageSubscription.find({ userId: user._id }).select('_id publicId purchaseAtUtc').lean();
    if (!subs.length) throw new Error(`No subscriptions for user ${userCode}`);
    return subs.map((s) => s._id);
  }

  throw new Error('Provide --buyer-user-code, --subscription-public-id, or --repair-all-null-asof-skips');
}

async function main() {
  await connectDb();
  const subscriptionIds = await resolveSubscriptionIds();
  logger.info({ count: subscriptionIds.length, dryRun: DRY_RUN }, 'reprocess-matching-subscription start');

  const results = [];
  for (const subscriptionId of subscriptionIds) {
    const result = await reprocessMatchingForSubscription({
      triggerPurchaseSubscriptionId: subscriptionId,
      dryRun: DRY_RUN,
    });
    results.push({ subscriptionId: String(subscriptionId), ...result });
  }

  logger.info({ results }, 'reprocess-matching-subscription completed');
  console.log(JSON.stringify(results, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'reprocess-matching-subscription failed');
    console.error(err);
    process.exit(1);
  });
