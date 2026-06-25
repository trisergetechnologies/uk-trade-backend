const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { connectDb } = require('../src/db/connect');
const {
  User,
  Wallet,
  TreeNode,
  PackageSubscription,
  MatchingIncomeEvent,
  Plan,
  WalletLedger,
} = require('../src/models');
const { creditMatchingOnPurchase } = require('../src/services/matching.service');
const { calculateMatchingPayout } = require('../src/services/matching-engine');
const { TABLE_D } = require('./fixtures/matching-tables.fixture');

let userSeq = 0;

async function createUser({ name, email, referredBy = null }) {
  userSeq += 1;
  const passwordHash = await bcrypt.hash('Test@12345', 10);
  const user = await User.create({
    name,
    email,
    passwordHash,
    role: 'user',
    referralCode: `TREF${String(userSeq).padStart(6, '0')}`,
    referredBy,
    preferredCommunity: 'left',
    isActive: true,
  });
  await Wallet.create({ userId: user._id, balance: 0, eligibleToWithdraw: 0 });
  return user;
}

async function createTreeNode({ userId, parentUserId, side, level }) {
  return TreeNode.create({
    userId,
    parentUserId,
    side,
    community: side,
    level,
  });
}

async function createSubscription({ userId, planId, principalAmount, purchaseAtUtc }) {
  return PackageSubscription.create({
    userId,
    planId,
    principalAmount,
    purchaseDateIst: '2026-01-01',
    purchaseAtUtc,
    withdrawalDay1Ist: '2026-01-02',
    firstEarningDateIst: '2026-01-02',
    status: 'active',
  });
}

describe('matching income (integration)', () => {
  let plan;

  beforeAll(async () => {
    await connectDb();
  });

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    plan = await Plan.create({
      code: 'A',
      name: 'Plan A',
      dailyPercent: 1,
      cycleDaysW: 25,
      maxWorkingDaysN: 225,
      isActive: true,
    });
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  async function seedTableDMini() {
    const earner = await createUser({ name: 'Earner M', email: 'earner-m@test.local' });
    const bl = await createUser({ name: 'BL', email: 'bl@test.local', referredBy: earner._id });
    const cr = await createUser({ name: 'CR', email: 'cr@test.local', referredBy: earner._id });

    await createTreeNode({ userId: earner._id, parentUserId: null, side: 'left', level: 0 });
    await createTreeNode({ userId: bl._id, parentUserId: earner._id, side: 'left', level: 1 });
    await createTreeNode({ userId: cr._id, parentUserId: earner._id, side: 'right', level: 1 });

    const t0 = new Date('2026-01-01T10:00:00.000Z');
    const blSub = await createSubscription({ userId: bl._id, planId: plan._id, principalAmount: 800, purchaseAtUtc: t0 });
    const crSub = await createSubscription({ userId: cr._id, planId: plan._id, principalAmount: 500, purchaseAtUtc: new Date(t0.getTime() + 1000) });
    const earnerSub = await createSubscription({
      userId: earner._id,
      planId: plan._id,
      principalAmount: 35000,
      purchaseAtUtc: new Date(t0.getTime() + 2000),
    });

    return { earner, bl, cr, blSub, crSub, earnerSub, t0 };
  }

  test('Table D row 1 — first matching credits 4% of considerable (500)', async () => {
    const { earner, bl, earnerSub } = await seedTableDMini();
    const d = await createUser({ name: 'D', email: 'd@test.local', referredBy: bl._id });
    await createTreeNode({ userId: d._id, parentUserId: bl._id, side: 'left', level: 2 });

    const dSub = await createSubscription({
      userId: d._id,
      planId: plan._id,
      principalAmount: 150,
      purchaseAtUtc: new Date('2026-01-02T10:00:00.000Z'),
    });

    const result = await creditMatchingOnPurchase({
      triggerBuyerUserId: d._id,
      triggerPurchaseSubscriptionId: dSub._id,
      asOfUtc: dSub.purchaseAtUtc,
    });

    expect(result.credited).toBe(1);
    const event = await MatchingIncomeEvent.findOne({ earnerUserId: earner._id, status: 'credited' }).lean();
    expect(event.considerableAmount).toBe(500);
    expect(event.legAtEarner).toBe('left');
    expect(event.payoutCreditedAmount).toBe(20);

    const earnerAfter = await User.findById(earner._id).lean();
    expect(earnerAfter.firstMatchingDone).toBe(true);
    expect(earnerAfter.matchingMatchedVolume).toBe(500);

    const wallet = await Wallet.findOne({ userId: earner._id }).lean();
    expect(wallet.balance).toBe(20);

    const purchaseAt = dSub.purchaseAtUtc.getTime();
    expect(new Date(event.createdAt).getTime()).toBe(purchaseAt);
    const ledger = await WalletLedger.findOne({ userId: earner._id, contextType: 'matching_income' }).lean();
    expect(new Date(ledger.createdAt).getTime()).toBe(purchaseAt);
  });

  test('idempotency — duplicate purchase trigger does not double-credit', async () => {
    const { earner, bl } = await seedTableDMini();
    const d = await createUser({ name: 'D', email: 'd2@test.local', referredBy: bl._id });
    await createTreeNode({ userId: d._id, parentUserId: bl._id, side: 'left', level: 2 });
    const dSub = await createSubscription({
      userId: d._id,
      planId: plan._id,
      principalAmount: 150,
      purchaseAtUtc: new Date('2026-01-02T10:00:00.000Z'),
    });

    const dResult = await creditMatchingOnPurchase({
      triggerBuyerUserId: d._id,
      triggerPurchaseSubscriptionId: dSub._id,
      asOfUtc: dSub.purchaseAtUtc,
    });
    expect(dResult.credited).toBe(1);
    const second = await creditMatchingOnPurchase({
      triggerBuyerUserId: d._id,
      triggerPurchaseSubscriptionId: dSub._id,
    });

    expect(second.duplicates).toBeGreaterThanOrEqual(1);
    const credited = await MatchingIncomeEvent.countDocuments({ earnerUserId: earner._id, status: 'credited' });
    expect(credited).toBe(1);
  });

  test('depth boundary — level 6 trigger does not match for level-0 earner', async () => {
    const { earner, bl, t0 } = await seedTableDMini();

    let parent = bl;
    let parentNode = await TreeNode.findOne({ userId: bl._id }).lean();
    const chain = [];
    for (let level = 2; level <= 6; level += 1) {
      const u = await createUser({
        name: `L${level}`,
        email: `l${level}@test.local`,
        referredBy: parent._id,
      });
      await createTreeNode({
        userId: u._id,
        parentUserId: parent._id,
        side: 'left',
        level: parentNode.level + 1,
      });
      await createSubscription({
        userId: u._id,
        planId: plan._id,
        principalAmount: 100,
        purchaseAtUtc: new Date(t0.getTime() + level * 1000),
      });
      chain.push(u);
      parent = u;
      parentNode = await TreeNode.findOne({ userId: u._id }).lean();
    }

    const deepBuyer = chain[chain.length - 1];
    const deepSub = await createSubscription({
      userId: deepBuyer._id,
      planId: plan._id,
      principalAmount: 200,
      purchaseAtUtc: new Date('2026-02-01T10:00:00.000Z'),
    });

    const result = await creditMatchingOnPurchase({
      triggerBuyerUserId: deepBuyer._id,
      triggerPurchaseSubscriptionId: deepSub._id,
    });

    expect(result.processed).toBeGreaterThanOrEqual(0);
    const events = await MatchingIncomeEvent.find({ earnerUserId: earner._id }).lean();
    expect(events.length).toBe(0);
  });

  test('package cap below 30k limits payout per event', async () => {
    const earner = await createUser({ name: 'SmallPkg', email: 'small@test.local' });
    const left = await createUser({ name: 'Left', email: 'left@test.local', referredBy: earner._id });
    const right = await createUser({ name: 'Right', email: 'right@test.local', referredBy: earner._id });

    await createTreeNode({ userId: earner._id, parentUserId: null, side: 'left', level: 0 });
    await createTreeNode({ userId: left._id, parentUserId: earner._id, side: 'left', level: 1 });
    await createTreeNode({ userId: right._id, parentUserId: earner._id, side: 'right', level: 1 });

    const t0 = new Date('2026-01-01T10:00:00.000Z');
    await createSubscription({ userId: left._id, planId: plan._id, principalAmount: 10000000, purchaseAtUtc: t0 });
    await createSubscription({ userId: right._id, planId: plan._id, principalAmount: 500000, purchaseAtUtc: new Date(t0.getTime() + 1000) });
    await createSubscription({
      userId: earner._id,
      planId: plan._id,
      principalAmount: 25000,
      purchaseAtUtc: new Date(t0.getTime() + 2000),
    });
    await User.updateOne({ _id: earner._id }, { $set: { firstMatchingDone: true, matchingMatchedVolume: 0 } });

    const buyer = await createUser({ name: 'Buyer', email: 'buyer@test.local', referredBy: right._id });
    await createTreeNode({ userId: buyer._id, parentUserId: right._id, side: 'right', level: 2 });
    const buyerSub = await createSubscription({
      userId: buyer._id,
      planId: plan._id,
      principalAmount: 10000000,
      purchaseAtUtc: new Date('2026-01-02T10:00:00.000Z'),
    });

    const result = await creditMatchingOnPurchase({
      triggerBuyerUserId: buyer._id,
      triggerPurchaseSubscriptionId: buyerSub._id,
      asOfUtc: buyerSub.purchaseAtUtc,
    });
    expect(result.credited).toBeGreaterThanOrEqual(1);

    const event = await MatchingIncomeEvent.findOne({ earnerUserId: earner._id, status: 'credited' }).lean();
    expect(event).toBeTruthy();
    expect(event.packageCapApplied).toBe(true);
    expect(event.payoutCreditedAmount).toBe(25000);
  });

  test('chronological replay — matched volume carries across purchases', async () => {
    const { earner, bl, cr } = await seedTableDMini();
    const d = await createUser({ name: 'D', email: 'd3@test.local', referredBy: bl._id });
    await createTreeNode({ userId: d._id, parentUserId: bl._id, side: 'left', level: 2 });
    const dSub = await createSubscription({
      userId: d._id,
      planId: plan._id,
      principalAmount: 150,
      purchaseAtUtc: new Date('2026-01-02T10:00:00.000Z'),
    });

    const dResult = await creditMatchingOnPurchase({
      triggerBuyerUserId: d._id,
      triggerPurchaseSubscriptionId: dSub._id,
      asOfUtc: dSub.purchaseAtUtc,
    });
    expect(dResult.credited).toBe(1);

    const afterD = await User.findById(earner._id).lean();
    expect(afterD.matchingMatchedVolume).toBe(500);

    const e = await createUser({ name: 'E', email: 'e@test.local', referredBy: cr._id });
    await createTreeNode({ userId: e._id, parentUserId: cr._id, side: 'left', level: 2 });
    const eSub = await createSubscription({
      userId: e._id,
      planId: plan._id,
      principalAmount: 120,
      purchaseAtUtc: new Date('2026-01-03T10:00:00.000Z'),
    });

    await creditMatchingOnPurchase({
      triggerBuyerUserId: e._id,
      triggerPurchaseSubscriptionId: eSub._id,
      asOfUtc: eSub.purchaseAtUtc,
    });

    const earnerAfter = await User.findById(earner._id).lean();
    expect(earnerAfter.matchingMatchedVolume).toBe(620);

    const events = await MatchingIncomeEvent.find({ earnerUserId: earner._id, status: 'credited' })
      .sort({ createdAt: 1 })
      .lean();
    expect(events.length).toBe(2);
    expect(events[0].considerableAmount).toBe(500);
    expect(events[1].considerableAmount).toBe(120);
  });

  test('live matching without asOfUtc counts active leg volumes (null-asOfUtc fix)', async () => {
    const { earner, bl, cr } = await seedTableDMini();
    const d = await createUser({ name: 'D', email: 'd-null-asof@test.local', referredBy: bl._id });
    await createTreeNode({ userId: d._id, parentUserId: bl._id, side: 'left', level: 2 });

    const dSub = await createSubscription({
      userId: d._id,
      planId: plan._id,
      principalAmount: 150,
      purchaseAtUtc: new Date('2026-01-02T10:00:00.000Z'),
    });

    await creditMatchingOnPurchase({
      triggerBuyerUserId: d._id,
      triggerPurchaseSubscriptionId: dSub._id,
      asOfUtc: dSub.purchaseAtUtc,
    });

    const e = await createUser({ name: 'E', email: 'e-null-asof@test.local', referredBy: cr._id });
    await createTreeNode({ userId: e._id, parentUserId: cr._id, side: 'left', level: 2 });
    const eSub = await createSubscription({
      userId: e._id,
      planId: plan._id,
      principalAmount: 120,
      purchaseAtUtc: new Date('2026-01-03T10:00:00.000Z'),
    });

    const result = await creditMatchingOnPurchase({
      triggerBuyerUserId: e._id,
      triggerPurchaseSubscriptionId: eSub._id,
    });

    expect(result.credited).toBeGreaterThanOrEqual(1);
    const event = await MatchingIncomeEvent.findOne({
      earnerUserId: earner._id,
      triggerBuyerUserId: e._id,
    }).lean();
    expect(event).toBeTruthy();
    expect(event.leftVolumeBefore).toBeGreaterThan(0);
    expect(event.rightVolumeBefore).toBeGreaterThan(0);
    expect(event.status).toBe('credited');
    expect(event.considerableAmount).toBeGreaterThan(0);
  });

  test('payout engine parity — 4% considerable with cap threshold', () => {
    const row = TABLE_D[0];
    const payout = calculateMatchingPayout({
      considerableAmount: row.expectedConsiderable,
      matchingPercent: 4,
      maxPackageAmount: 35000,
      capThreshold: 30000,
    });
    expect(payout.payoutCreditedAmount).toBe(20);
  });
});
