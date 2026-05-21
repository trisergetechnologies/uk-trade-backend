const { MatchingIncomeEvent, SponsorIncomeEvent } = require('../models');

function pickSourceFromMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;
  const name = metadata.sourceName;
  const code = metadata.sourceUserCode;
  if (name && code) return { sourceName: name, sourceUserCode: code, sourceLabel: `${name} (${code})` };
  if (name) return { sourceName: name, sourceUserCode: code || null, sourceLabel: name };
  return null;
}

async function enrichLedgerEntries(entries, userId) {
  if (!entries.length) return [];

  const sponsorSubIds = [];
  const matchingContextIds = [];
  for (const entry of entries) {
    if (entry.contextType === 'sponsor_income' && entry.packageSubscriptionId) {
      sponsorSubIds.push(entry.packageSubscriptionId);
    }
    if (entry.contextType === 'matching_income' && entry.contextId) {
      matchingContextIds.push(entry.contextId);
    }
  }

  const [sponsorEvents, matchingEvents] = await Promise.all([
    sponsorSubIds.length
      ? SponsorIncomeEvent.find({
          packageSubscriptionId: { $in: sponsorSubIds },
          referrerUserId: userId,
        })
          .populate('buyerUserId', 'name userCode')
          .lean()
      : [],
    matchingContextIds.length
      ? MatchingIncomeEvent.find({
          _id: { $in: matchingContextIds },
          earnerUserId: userId,
        })
          .populate('triggerBuyerUserId', 'name userCode')
          .lean()
      : [],
  ]);

  const sponsorBySub = new Map(
    sponsorEvents.map((e) => [String(e.packageSubscriptionId), e])
  );
  const matchingById = new Map(matchingEvents.map((e) => [String(e._id), e]));

  return entries.map((entry) => {
    const plain = entry.toObject ? entry.toObject() : { ...entry };
    let sourceName = null;
    let sourceUserCode = null;
    let sourceLabel = null;

    const fromMeta = pickSourceFromMetadata(plain.metadata);
    if (fromMeta) {
      sourceName = fromMeta.sourceName;
      sourceUserCode = fromMeta.sourceUserCode;
      sourceLabel = fromMeta.sourceLabel;
    }

    if (plain.contextType === 'sponsor_income') {
      const ev = sponsorBySub.get(String(plain.packageSubscriptionId));
      const buyer = ev?.buyerUserId;
      if (buyer?.name) {
        sourceName = buyer.name;
        sourceUserCode = buyer.userCode || null;
        sourceLabel = buyer.userCode ? `${buyer.name} (${buyer.userCode})` : buyer.name;
      }
    } else if (plain.contextType === 'matching_income') {
      const ev = matchingById.get(String(plain.contextId));
      const trigger = ev?.triggerBuyerUserId;
      if (trigger?.name) {
        sourceName = trigger.name;
        sourceUserCode = trigger.userCode || null;
        sourceLabel = trigger.userCode ? `${trigger.name} (${trigger.userCode})` : trigger.name;
      }
    }

    return {
      ...plain,
      sourceName: sourceName || undefined,
      sourceUserCode: sourceUserCode || undefined,
      sourceLabel: sourceLabel || undefined,
    };
  });
}

module.exports = { enrichLedgerEntries };
