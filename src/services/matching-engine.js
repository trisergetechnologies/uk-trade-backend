function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

function splitByFirstBranch(rootUserId, descendants) {
  const byParent = new Map();
  for (const node of descendants) {
    const parentKey = String(node.parentUserId || '');
    if (!byParent.has(parentKey)) byParent.set(parentKey, []);
    byParent.get(parentKey).push(node);
  }
  const rootChildren = byParent.get(String(rootUserId)) || [];
  const result = { left: [], right: [] };
  for (const child of rootChildren) {
    const sideKey = child.side === 'right' ? 'right' : 'left';
    const stack = [child];
    while (stack.length) {
      const current = stack.pop();
      result[sideKey].push(current);
      const children = byParent.get(String(current.userId)) || [];
      for (const c of children) stack.push(c);
    }
  }
  return result;
}

function determineLegAtEarner(triggerUserId, split) {
  const id = String(triggerUserId);
  if (split.left.some((n) => String(n.userId) === id)) return 'left';
  if (split.right.some((n) => String(n.userId) === id)) return 'right';
  return null;
}

/**
 * Pure considerable calculator — volume overlap matching.
 * leftVolume/rightVolume are totals BEFORE adding trigger purchase V.
 */
function calculateConsiderable({
  V,
  leftVolume,
  rightVolume,
  matched,
  legAtEarner,
  firstMatchingDone,
  parentAmount = 0,
}) {
  const v = round2(V);
  const L = round2(leftVolume);
  const R = round2(rightVolume);
  const m = round2(matched);
  const leg = legAtEarner === 'right' ? 'right' : 'left';

  if (!firstMatchingDone) {
    const bundle = round2(v + round2(parentAmount));
    const opposite = leg === 'left' ? R : L;
    const considerable = round2(Math.min(bundle, opposite));
    return {
      considerable,
      matchedAfter: round2(m + considerable),
      firstMatchingDoneAfter: true,
      rule: 'first-bundle',
    };
  }

  if (leg === 'left') {
    if (L > R) {
      return {
        considerable: 0,
        matchedAfter: m,
        firstMatchingDoneAfter: true,
        rule: 'ongoing-long-left',
      };
    }
    const room = round2(R - m);
    const considerable = round2(Math.min(v, Math.max(0, room)));
    return {
      considerable,
      matchedAfter: round2(m + considerable),
      firstMatchingDoneAfter: true,
      rule: 'ongoing-short-left',
    };
  }

  if (R > L) {
    return {
      considerable: 0,
      matchedAfter: m,
      firstMatchingDoneAfter: true,
      rule: 'ongoing-long-right',
    };
  }
  const room = round2(L - m);
  const considerable = round2(Math.min(v, Math.max(0, room)));
  return {
    considerable,
    matchedAfter: round2(m + considerable),
    firstMatchingDoneAfter: true,
    rule: 'ongoing-short-right',
  };
}

/**
 * Payout = matchingPercent × considerable.
 * If earner max active package < capThreshold → cap at maxPackage per event.
 * If maxPackage >= capThreshold → full raw payout (no package cap).
 */
function calculateMatchingPayout({
  considerableAmount,
  matchingPercent,
  maxPackageAmount,
  capThreshold = 30000,
}) {
  const rawPayoutAmount = round2((Number(considerableAmount || 0) * Number(matchingPercent || 0)) / 100);
  const maxPkg = round2(Math.max(0, Number(maxPackageAmount || 0)));
  const threshold = Number(capThreshold || 30000);

  let payoutCreditedAmount = rawPayoutAmount;
  let packageCapApplied = false;

  if (maxPkg <= 0) {
    payoutCreditedAmount = 0;
  } else if (maxPkg < threshold) {
    payoutCreditedAmount = round2(Math.min(rawPayoutAmount, maxPkg));
    packageCapApplied = payoutCreditedAmount < rawPayoutAmount;
  }

  const perEventCapAmount = maxPkg < threshold ? maxPkg : maxPkg;

  return {
    rawPayoutAmount,
    maxPackageAmount: maxPkg,
    packageCapThreshold: threshold,
    packageCapApplied,
    payoutCreditedAmount,
    perEventCapAmount,
    capRemainingBeforeAmount: perEventCapAmount,
    capRemainingAfterAmount: perEventCapAmount,
  };
}

module.exports = {
  round2,
  splitByFirstBranch,
  determineLegAtEarner,
  calculateConsiderable,
  calculateMatchingPayout,
};
