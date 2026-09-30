/**
 * Read-only user money diagnosis. Does not update anything.
 *
 * Uses the same rules as eligibility.service.js / wallet.service.js:
 *   Eligible = unlocked trade + sponsor + matching + leftover admin bonus
 *            + fund transfers in − fund transfers out
 *            − matching already paid by admin − approved withdrawals − pending withdrawals
 *   (floor at 0)
 *
 * Wallet balance is a different number: all ledger credits minus all ledger debits.
 * Pending withdrawals reduce Eligible but do not leave the wallet until approved.
 * Trade still inside a W-cycle is in the wallet but not yet Eligible.
 *
 * Usage (mongosh), from uk-trade-backend:
 *   mongosh "<connection-string>" --file scripts/mongosh-diagnose-user.js
 *
 * Or inside an already-open shell:
 *   use <your-db-name>
 *   load("scripts/mongosh-diagnose-user.js")
 */

const EMAIL = 'satendermahto9911@gmail.com';

/** Fallback only when wallets.matchingPaidByAdmin is missing or 0. Same map as matching-paid-by-admin.js */
const MATCHING_PAID_BY_ADMIN_BY_USER_CODE = {
  '99547': 6640,
  '88531': 8760,
  '73351': 4900,
  '95353': 5200,
  '08407': 1680,
  '82998': 2550,
  '84822': 4000,
  '56939': 4200,
};

function r2(n) {
  return Number(Number(n || 0).toFixed(2));
}

function sumOf(rows, pick) {
  let t = 0;
  for (const row of rows) t += Number(pick(row)) || 0;
  return t;
}

function addIstDays(isoDate, days) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

function istCmp(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function todayIst() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function grossEligibleForSubscription(sub, plan, credits, today) {
  if (!credits.length || !plan) return { unlocked: 0, locked: 0, cycles: [] };
  const D0 = sub.withdrawalDay1Ist;
  const W = Number(plan.cycleDaysW);
  const sorted = credits.slice().sort((a, b) => String(a.creditDateIst).localeCompare(String(b.creditDateIst)));
  const maxCycle = Math.max(...sorted.map((c) => c.cycleNumber));
  const lastCreditIst = sorted[sorted.length - 1].creditDateIst;
  const isCompleted = sub.status === 'completed';
  const nominalEndLast = addIstDays(D0, maxCycle * W - 1);
  const isPartialLastCycle = isCompleted && istCmp(lastCreditIst, nominalEndLast) < 0;

  const byCycle = new Map();
  for (const c of sorted) {
    const prev = byCycle.get(c.cycleNumber) || { amount: 0, days: 0, first: c.creditDateIst, last: c.creditDateIst };
    prev.amount += Number(c.amount) || 0;
    prev.days += 1;
    if (c.creditDateIst < prev.first) prev.first = c.creditDateIst;
    if (c.creditDateIst > prev.last) prev.last = c.creditDateIst;
    byCycle.set(c.cycleNumber, prev);
  }

  let unlocked = 0;
  let locked = 0;
  const cycles = [];
  for (const [cycleK, bucket] of [...byCycle.entries()].sort((a, b) => a[0] - b[0])) {
    const K = Number(cycleK);
    const gate = addIstDays(D0, K * W);
    let isUnlocked = false;
    let why = '';
    if (isPartialLastCycle && K === maxCycle) {
      isUnlocked = true;
      why = 'completed partial last cycle (unlocked immediately)';
    } else if (istCmp(today, gate) >= 0) {
      isUnlocked = true;
      why = 'gate day ' + gate + ' has passed';
    } else {
      why = 'locked until gate day ' + gate;
    }
    const amount = r2(bucket.amount);
    if (isUnlocked) unlocked += bucket.amount;
    else locked += bucket.amount;
    cycles.push({
      cycle: K,
      daysCredited: bucket.days,
      amount,
      firstCredit: bucket.first,
      lastCredit: bucket.last,
      gateDay: gate,
      unlocked: isUnlocked,
      why,
    });
  }
  return { unlocked, locked, cycles };
}

function packageSpendFromEligible(entries) {
  const sorted = entries.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  let deposit = 0;
  let bonus = 0;
  const chunks = [];
  const spent = { fundTransferIn: 0, sponsor: 0, matching: 0 };
  const spendKey = { transfer: 'fundTransferIn', sponsor: 'sponsor', matching: 'matching' };
  function consumeChunks(amount, record) {
    let rest = amount;
    for (const chunk of chunks) {
      if (rest <= 0) break;
      if (chunk.left <= 0) continue;
      const takeAmt = Math.min(chunk.left, rest);
      chunk.left -= takeAmt;
      rest -= takeAmt;
      if (record) spent[spendKey[chunk.kind]] += takeAmt;
    }
    return amount - rest;
  }
  for (const entry of sorted) {
    const amt = Number(entry.amount) || 0;
    if (amt <= 0) continue;
    if (entry.direction === 'credit' && entry.contextType === 'fund_request_approval') deposit += amt;
    else if (entry.direction === 'credit' && entry.contextType === 'admin_credit') bonus += amt;
    else if (entry.direction === 'credit' && entry.contextType === 'fund_transfer_in') chunks.push({ kind: 'transfer', left: amt });
    else if (entry.direction === 'credit' && entry.contextType === 'sponsor_income') chunks.push({ kind: 'sponsor', left: amt });
    else if (entry.direction === 'credit' && entry.contextType === 'matching_income') chunks.push({ kind: 'matching', left: amt });
    else if (entry.direction === 'debit' && entry.contextType === 'package_purchase') {
      const fromBonus = Math.min(bonus, amt);
      bonus -= fromBonus;
      let rest = amt - fromBonus;
      const fromDeposit = Math.min(deposit, rest);
      deposit -= fromDeposit;
      rest -= fromDeposit;
      consumeChunks(rest, true);
    } else if (entry.direction === 'debit' && (entry.contextType === 'withdrawal_approved' || entry.contextType === 'fund_transfer_out')) {
      let rest = amt;
      rest -= consumeChunks(rest, false);
      deposit -= Math.min(deposit, rest);
    }
  }
  return {
    fundTransferIn: r2(spent.fundTransferIn),
    sponsor: r2(spent.sponsor),
    matching: r2(spent.matching),
    total: r2(spent.fundTransferIn + spent.sponsor + spent.matching),
  };
}

function replayEligibleBonus(ledger) {
  const sorted = ledger.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  let bonus = 0;
  for (const entry of sorted) {
    const amt = Number(entry.amount) || 0;
    if (entry.direction === 'credit' && entry.contextType === 'admin_credit') bonus += amt;
    else if (entry.direction === 'debit' && entry.contextType === 'package_purchase') bonus = Math.max(0, bonus - amt);
  }
  return bonus;
}

function ledgerSum(ledger, direction, contextType) {
  return sumOf(
    ledger.filter((e) => e.direction === direction && (!contextType || e.contextType === contextType)),
    (e) => e.amount
  );
}

function check(label, left, right) {
  const a = r2(left);
  const b = r2(right);
  const delta = r2(a - b);
  const ok = Math.abs(a - b) < 0.01;
  return { check: label, ok, left: a, right: b, delta };
}

const email = String(EMAIL).trim().toLowerCase();
const user = db.users.findOne(
  { email },
  { passwordHash: 0, passwordCipher: 0, bankAccount: 0 }
);
if (!user) {
  print('No user with email: ' + email);
  print('Database: ' + db.getName());
  quit(1);
}

const uid = user._id;
const today = todayIst();
const wallet = db.wallets.findOne({ userId: uid }) || {
  balance: 0,
  eligibleToWithdraw: 0,
  eligibleBonus: 0,
  matchingPaidByAdmin: 0,
  lastGrossEligibleTrade: null,
};

const ledger = db.walletledgers.find({ userId: uid }).toArray();
const subs = db.packagesubscriptions.find({ userId: uid }).sort({ purchaseDateIst: 1 }).toArray();
const planIds = subs.map((s) => s.planId);
const plans = planIds.length ? db.plans.find({ _id: { $in: planIds } }).toArray() : [];
const planById = {};
for (const p of plans) planById[String(p._id)] = p;

const tradeEvents = db.tradecreditevents.find({ userId: uid }).sort({ creditDateIst: 1 }).toArray();
const sponsorEvents = db.sponsorincomeevents.find({ referrerUserId: uid }).toArray();
const matchingEvents = db.matchingincomeevents.find({ earnerUserId: uid }).toArray();
const withdrawals = db.withdrawalrequests.find({ userId: uid }).sort({ createdAt: 1 }).toArray();
const transfersOut = db.fundtransfers.find({ fromUserId: uid }).toArray();
const transfersIn = db.fundtransfers.find({ toUserId: uid }).toArray();
const payments = db.paymentrequests.find({ userId: uid }).toArray();

const tradeAll = sumOf(tradeEvents, (e) => e.amount);
const sponsorCredited = sumOf(sponsorEvents, (e) => e.creditedAmount);
const sponsorGrossField = sumOf(sponsorEvents, (e) => e.grossAmount);
const matchingCredited = sumOf(
  matchingEvents.filter((e) => e.status === 'credited'),
  (e) => e.payoutCreditedAmount
);
const matchingSkipped = sumOf(
  matchingEvents.filter((e) => e.status !== 'credited'),
  (e) => e.payoutCreditedAmount
);

let tradeUnlocked = 0;
let tradeLocked = 0;
let tradeUnclassified = 0;
const packages = [];
const subIds = {};
for (const sub of subs) subIds[String(sub._id)] = true;
for (const sub of subs) {
  const plan = planById[String(sub.planId)] || null;
  const credits = tradeEvents.filter((e) => String(e.packageSubscriptionId) === String(sub._id));
  const split = grossEligibleForSubscription(sub, plan, credits, today);
  if (!plan) tradeUnclassified += sumOf(credits, (c) => c.amount);
  else {
    tradeUnlocked += split.unlocked;
    tradeLocked += split.locked;
  }
  packages.push({
    publicId: sub.publicId,
    plan: plan ? plan.code + ' / ' + plan.name : String(sub.planId),
    cycleDaysW: plan ? plan.cycleDaysW : null,
    principal: r2(sub.principalAmount),
    status: sub.status,
    purchaseDateIst: sub.purchaseDateIst,
    withdrawalDay1Ist: sub.withdrawalDay1Ist,
    workingDaysCredited: sub.workingDaysCredited,
    tradeCredited: r2(sumOf(credits, (c) => c.amount)),
    tradeUnlocked: r2(split.unlocked),
    tradeLocked: r2(split.locked),
    cycles: split.cycles,
    planMissing: !plan,
  });
}
const orphanTrade = tradeEvents.filter((e) => !subIds[String(e.packageSubscriptionId)]);
tradeUnclassified += sumOf(orphanTrade, (e) => e.amount);

const wd = { pending: [], approved: [], rejected: [] };
for (const w of withdrawals) {
  const bucket = wd[w.status] || (wd[w.status] = []);
  bucket.push(w);
}
function wdTotals(rows) {
  return {
    count: rows.length,
    gross: r2(sumOf(rows, (w) => w.amount)),
    tds: r2(sumOf(rows, (w) => w.tdsAmount)),
    handling: r2(sumOf(rows, (w) => w.handlingAmount)),
    netPayable: r2(sumOf(rows, (w) => w.netPayable)),
  };
}
const pendingTot = wdTotals(wd.pending || []);
const approvedTot = wdTotals(wd.approved || []);
const rejectedTot = wdTotals(wd.rejected || []);

const storedMatchingPaid = Number(wallet.matchingPaidByAdmin);
const matchingPaidByAdmin =
  Number.isFinite(storedMatchingPaid) && storedMatchingPaid > 0
    ? storedMatchingPaid
    : Number(MATCHING_PAID_BY_ADMIN_BY_USER_CODE[String(user.userCode || '').trim()] || 0);

const bonusStored = Math.max(0, Number(wallet.eligibleBonus) || 0);
const bonusReplay = replayEligibleBonus(ledger);
const fundInLedger = ledgerSum(ledger, 'credit', 'fund_transfer_in');
const fundOutLedger = ledgerSum(ledger, 'debit', 'fund_transfer_out');
const fundInDocs = sumOf(transfersIn, (t) => t.amount);
const fundOutDocs = sumOf(transfersOut, (t) => t.amount);

const approved = sumOf(wd.approved || [], (w) => w.amount);
const pending = sumOf(wd.pending || [], (w) => w.amount);
const packageSpend = packageSpendFromEligible(ledger);

const eligibleRaw =
  tradeUnlocked +
  sponsorCredited +
  matchingCredited +
  bonusStored +
  fundInLedger -
  fundOutLedger -
  matchingPaidByAdmin -
  approved -
  pending -
  packageSpend.total;
const eligibleComputed = Math.max(0, r2(eligibleRaw));

const creditsAll = ledgerSum(ledger, 'credit');
const debitsAll = ledgerSum(ledger, 'debit');
const ledgerNet = creditsAll - debitsAll;

const byContext = {};
for (const e of ledger) {
  const key = e.direction + ':' + e.contextType;
  if (!byContext[key]) byContext[key] = { count: 0, amount: 0 };
  byContext[key].count += 1;
  byContext[key].amount += Number(e.amount) || 0;
}
const ledgerByContext = Object.keys(byContext)
  .sort()
  .map((key) => ({ context: key, count: byContext[key].count, amount: r2(byContext[key].amount) }));

const knownCreditTypes = [
  'fund_request_approval',
  'admin_credit',
  'sponsor_income',
  'matching_income',
  'trade_income',
  'fund_transfer_in',
];
const knownDebitTypes = ['package_purchase', 'withdrawal_approved', 'fund_transfer_out'];
let explainedCredits = 0;
let explainedDebits = 0;
const unknownContexts = [];
for (const row of ledgerByContext) {
  const [direction, contextType] = row.context.split(':');
  if (direction === 'credit' && knownCreditTypes.includes(contextType)) explainedCredits += row.amount;
  else if (direction === 'debit' && knownDebitTypes.includes(contextType)) explainedDebits += row.amount;
  else unknownContexts.push(row);
}

const tradeLeftAfterApproved = Math.max(0, tradeAll - approved);
const tradeReservedInWallet = Math.min(Math.max(0, Number(wallet.balance) || 0), tradeLeftAfterApproved);
const spendableForPackages = Math.max(0, r2((Number(wallet.balance) || 0) - tradeReservedInWallet));

function takeStream(state, amount) {
  const avail = Math.max(0, Number(amount) || 0);
  const used = Math.min(avail, state.left);
  state.left -= used;
  return r2(avail - used);
}
const consume = { left: approved + pending + Math.max(0, fundOutLedger - fundInLedger) };
const tradeLeftInEligible = takeStream(consume, tradeUnlocked);
const bonusLeftInEligible = takeStream(consume, bonusStored);
const sponsorAvailable = takeStream(consume, Math.max(0, sponsorCredited - packageSpend.sponsor));
const matchingAvailable = takeStream(consume, Math.max(0, matchingCredited - matchingPaidByAdmin - packageSpend.matching));

const checks = [
  check('wallet.balance vs ledger net (credits − debits)', wallet.balance, ledgerNet),
  check('sponsor events vs ledger sponsor_income', sponsorCredited, ledgerSum(ledger, 'credit', 'sponsor_income')),
  check('matching credited events vs ledger matching_income', matchingCredited, ledgerSum(ledger, 'credit', 'matching_income')),
  check('trade credit events vs ledger trade_income', tradeAll, ledgerSum(ledger, 'credit', 'trade_income')),
  check('approved withdrawals vs ledger withdrawal_approved', approved, ledgerSum(ledger, 'debit', 'withdrawal_approved')),
  check('fund transfer docs in vs ledger fund_transfer_in', fundInDocs, fundInLedger),
  check('fund transfer docs out vs ledger fund_transfer_out', fundOutDocs, fundOutLedger),
  check('wallet.eligibleBonus vs ledger replay (admin_credit − package_purchase)', bonusStored, bonusReplay),
  check('wallet.eligibleToWithdraw vs recomputed Eligible', wallet.eligibleToWithdraw, eligibleComputed),
  check('trade events unlocked+locked+unclassified vs all trade events', tradeUnlocked + tradeLocked + tradeUnclassified, tradeAll),
];

const summary = {
  database: db.getName(),
  asOfIst: today,
  user: {
    id: String(uid),
    name: user.name,
    email: user.email,
    userCode: user.userCode,
    referralCode: user.referralCode,
    isActive: user.isActive,
    kycStatus: user.kyc && user.kyc.status,
    firstMatchingDone: user.firstMatchingDone,
    matchingMatchedVolume: user.matchingMatchedVolume,
  },
  incomeTillNow: {
    sponsorCredited: r2(sponsorCredited),
    sponsorEventGrossBeforeCap: r2(sponsorGrossField),
    sponsorEventCount: sponsorEvents.length,
    matchingCredited: r2(matchingCredited),
    matchingCreditedCount: matchingEvents.filter((e) => e.status === 'credited').length,
    matchingNotCreditedCount: matchingEvents.filter((e) => e.status !== 'credited').length,
    matchingNotCreditedPayoutField: r2(matchingSkipped),
    tradeCreditedAll: r2(tradeAll),
    tradeUnlockedEligible: r2(tradeUnlocked),
    tradeStillLocked: r2(tradeLocked),
    tradeUnclassified: r2(tradeUnclassified),
    tradeEventCount: tradeEvents.length,
  },
  withdrawals: {
    pending: pendingTot,
    approved: approvedTot,
    rejected: rejectedTot,
    note: 'Eligible and wallet debit use gross amount. netPayable is what admin sends after 5% TDS + 5% handling. Pending reduces Eligible but stays in wallet.balance until approved. Rejected affects neither.',
  },
  wallet: {
    balance: r2(wallet.balance),
    eligibleToWithdrawStored: r2(wallet.eligibleToWithdraw),
    eligibleBonusStored: r2(bonusStored),
    matchingPaidByAdmin: r2(matchingPaidByAdmin),
    lastGrossEligibleTrade: wallet.lastGrossEligibleTrade == null ? null : r2(wallet.lastGrossEligibleTrade),
    spendableForPackages: r2(spendableForPackages),
    tradeReservedInWallet: r2(tradeReservedInWallet),
  },
  eligibleFormula: {
    unlockedTrade: r2(tradeUnlocked),
    plusSponsor: r2(sponsorCredited),
    plusMatching: r2(matchingCredited),
    plusEligibleBonus: r2(bonusStored),
    plusFundTransferIn: r2(fundInLedger),
    minusFundTransferOut: r2(fundOutLedger),
    minusMatchingPaidByAdmin: r2(matchingPaidByAdmin),
    minusApprovedWithdrawalsGross: r2(approved),
    minusPendingWithdrawalsGross: r2(pending),
    minusPackageSpendFromEligible: packageSpend.total,
    packageSpend,
    rawBeforeFloor: r2(eligibleRaw),
    eligibleComputed: eligibleComputed,
    eligibleStored: r2(wallet.eligibleToWithdraw),
    storedMinusComputed: r2((Number(wallet.eligibleToWithdraw) || 0) - eligibleComputed),
  },
  stillAvailableInsideEligible: {
    note: 'Withdrawals consume unlocked trade first, then admin bonus, then sponsor, then matching.',
    tradeLeft: tradeLeftInEligible,
    bonusLeft: bonusLeftInEligible,
    sponsorAvailable,
    matchingAvailable,
    unallocatedWithdrawalPressure: r2(consume.left),
  },
  balanceBridge: {
    credits: {
      fund_request_approval: r2(ledgerSum(ledger, 'credit', 'fund_request_approval')),
      admin_credit: r2(ledgerSum(ledger, 'credit', 'admin_credit')),
      sponsor_income: r2(ledgerSum(ledger, 'credit', 'sponsor_income')),
      matching_income: r2(ledgerSum(ledger, 'credit', 'matching_income')),
      trade_income: r2(ledgerSum(ledger, 'credit', 'trade_income')),
      fund_transfer_in: r2(fundInLedger),
    },
    debits: {
      package_purchase: r2(ledgerSum(ledger, 'debit', 'package_purchase')),
      withdrawal_approved: r2(ledgerSum(ledger, 'debit', 'withdrawal_approved')),
      fund_transfer_out: r2(fundOutLedger),
    },
    explainedNet: r2(explainedCredits - explainedDebits),
    ledgerNet: r2(ledgerNet),
    walletBalance: r2(wallet.balance),
    unknownContexts,
  },
  deposits: {
    paymentRequestCount: payments.length,
    approvedAmount: r2(sumOf(payments.filter((p) => p.status === 'approved'), (p) => p.approvedAmount != null ? p.approvedAmount : p.requestedAmount)),
    pendingAmount: r2(sumOf(payments.filter((p) => p.status === 'pending'), (p) => p.requestedAmount)),
    rejectedCount: payments.filter((p) => p.status === 'rejected').length,
  },
  alignment: checks,
  alignmentOk: checks.every((c) => c.ok),
};

print('\n========== USER MONEY DIAGNOSIS ==========');
print('DB: ' + summary.database + '    as of IST: ' + today);
print(user.name + ' <' + user.email + '>  code ' + user.userCode + '  kyc ' + (user.kyc && user.kyc.status));
print('');
print('INCOME TILL NOW');
print('  sponsor credited     ' + summary.incomeTillNow.sponsorCredited + '   (' + sponsorEvents.length + ' events, gross before cap ' + summary.incomeTillNow.sponsorEventGrossBeforeCap + ')');
print('  matching credited    ' + summary.incomeTillNow.matchingCredited + '   (' + summary.incomeTillNow.matchingCreditedCount + ' credited, ' + summary.incomeTillNow.matchingNotCreditedCount + ' skipped/duplicate)');
print('  trade credited       ' + summary.incomeTillNow.tradeCreditedAll);
print('  trade unlocked       ' + summary.incomeTillNow.tradeUnlockedEligible + '   (counts toward Eligible)');
print('  trade still locked   ' + summary.incomeTillNow.tradeStillLocked + '   (in wallet, not yet Eligible)');
if (summary.incomeTillNow.tradeUnclassified) {
  print('  trade unclassified   ' + summary.incomeTillNow.tradeUnclassified + '   (no plan, or credit with no package)');
}
print('');
print('WITHDRAWALS (gross leaves Eligible; approved gross also leaves wallet)');
print('  pending   n=' + pendingTot.count + '  gross=' + pendingTot.gross + '  tds=' + pendingTot.tds + '  handling=' + pendingTot.handling + '  netPayable=' + pendingTot.netPayable);
print('  approved  n=' + approvedTot.count + '  gross=' + approvedTot.gross + '  tds=' + approvedTot.tds + '  handling=' + approvedTot.handling + '  netPayable=' + approvedTot.netPayable);
print('  rejected  n=' + rejectedTot.count + '  gross=' + rejectedTot.gross + '  (ignored)');
print('');
print('WALLET');
print('  balance              ' + summary.wallet.balance);
print('  eligible stored      ' + summary.wallet.eligibleToWithdrawStored);
print('  eligible computed    ' + summary.eligibleFormula.eligibleComputed);
print('  spendable for packs  ' + summary.wallet.spendableForPackages + '   (balance minus trade still reserved)');
print('');
print('ELIGIBLE = unlockedTrade + sponsor + matching + bonus + transfersIn - transfersOut - matchingPaidByAdmin - approved - pending - packageSpendFromEligible');
print('         = ' + summary.eligibleFormula.unlockedTrade
  + ' + ' + summary.eligibleFormula.plusSponsor
  + ' + ' + summary.eligibleFormula.plusMatching
  + ' + ' + summary.eligibleFormula.plusEligibleBonus
  + ' + ' + summary.eligibleFormula.plusFundTransferIn
  + ' - ' + summary.eligibleFormula.minusFundTransferOut
  + ' - ' + summary.eligibleFormula.minusMatchingPaidByAdmin
  + ' - ' + summary.eligibleFormula.minusApprovedWithdrawalsGross
  + ' - ' + summary.eligibleFormula.minusPendingWithdrawalsGross
  + ' - ' + summary.eligibleFormula.minusPackageSpendFromEligible
  + '  => ' + summary.eligibleFormula.eligibleComputed);
print('');
print('STILL AVAILABLE INSIDE ELIGIBLE (consumption order: trade, bonus, sponsor, matching)');
print('  trade left     ' + tradeLeftInEligible);
print('  bonus left     ' + bonusLeftInEligible);
print('  sponsor left   ' + sponsorAvailable);
print('  matching left  ' + matchingAvailable);
print('');
print('ALIGNMENT');
for (const c of checks) {
  print((c.ok ? '  OK       ' : '  MISMATCH ') + c.check);
  if (!c.ok) print('           left=' + c.left + ' right=' + c.right + ' delta=' + c.delta);
}
print(summary.alignmentOk ? '\nAll checks aligned.' : '\nOne or more checks do not align. See alignment[] in the JSON.');
print('\n--- JSON ---');
printjson({
  summary,
  packages,
  withdrawals: withdrawals.map((w) => ({
    publicId: w.publicId,
    status: w.status,
    gross: r2(w.amount),
    tds: r2(w.tdsAmount),
    handling: r2(w.handlingAmount),
    netPayable: r2(w.netPayable),
    createdAt: w.createdAt,
    reviewReason: w.reviewReason || '',
  })),
  ledgerByContext,
  matchingByStatus: ['credited', 'skipped', 'duplicate'].map((status) => ({
    status,
    count: matchingEvents.filter((e) => e.status === status).length,
    payoutCreditedAmount: r2(sumOf(matchingEvents.filter((e) => e.status === status), (e) => e.payoutCreditedAmount)),
    rawPayoutAmount: r2(sumOf(matchingEvents.filter((e) => e.status === status), (e) => e.rawPayoutAmount)),
  })),
});
