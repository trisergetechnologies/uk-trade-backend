const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../src/app');
const { connectDb } = require('../src/db/connect');
const { env } = require('../src/config/env');
const { seedDefaultPlans } = require('../src/services/plan.service');
const { bootstrapAdmin, ensureSeedMainUser } = require('../src/services/auth.service');

beforeAll(async () => {
  await connectDb();
  await mongoose.connection.dropDatabase();
  await seedDefaultPlans();
  await bootstrapAdmin();
  await ensureSeedMainUser();
});

afterAll(async () => {
  await mongoose.connection.close();
});

describe('HTTP API (integration)', () => {
  let userToken;
  let adminToken;
  let userPassword = env.seedSharedPassword;

  beforeAll(async () => {
    const u = await request(app).post('/api/auth/login').send({
      email: env.seedUserEmail,
      password: env.seedSharedPassword,
    });
    expect(u.status).toBe(200);
    expect(u.body.data.token).toBeTruthy();
    userToken = u.body.data.token;

    const a = await request(app).post('/api/auth/login').send({
      email: env.adminBootstrapEmail,
      password: env.seedSharedPassword,
    });
    expect(a.status).toBe(200);
    adminToken = a.body.data.token;
  });

  async function registerAndLogin({ name, email, referralCode, community, mobileNumber = '9998887777' }) {
    const reg = await request(app).post('/api/auth/register').send({
      name,
      email,
      mobileNumber,
      password: userPassword,
      referralCode,
      community,
    });
    expect(reg.status).toBe(201);
    const login = await request(app).post('/api/auth/login').send({ email, password: userPassword });
    expect(login.status).toBe(200);
    return login.body.data.token;
  }

  async function addFundsAndBuyPackage(token, amount, packageCode = 'P01', planCode = 'A') {
    const create = await request(app).post('/api/fund-requests').set('Authorization', `Bearer ${token}`).send({
      amount,
      screenshotUrl: 'https://example.com/proof.png',
      notes: `funding ${amount}`,
    });
    expect(create.status).toBe(201);
    const id = create.body.data.id;
    const approve = await request(app)
      .patch(`/api/fund-requests/admin/${id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'approved', approvedAmount: amount, reason: 'test approve' });
    expect(approve.status).toBe(200);
    const buy = await request(app)
      .post('/api/packages/purchase')
      .set('Authorization', `Bearer ${token}`)
      .send({ packageCode, planCode });
    expect(buy.status).toBe(201);
    return buy.body.data;
  }

  it('GET /api/health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('POST /api/auth/login rejects bad password', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: env.seedUserEmail,
      password: 'wrong-password-xyz',
    });
    expect(res.status).toBe(401);
  });

  it('GET /api/wallet/me requires auth', async () => {
    const res = await request(app).get('/api/wallet/me');
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/me (user)', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(env.seedUserEmail.toLowerCase());
    expect(res.body.data.referralCode).toBeTruthy();
    expect(res.body.data.userCode).toBeTruthy();
  });

  it('GET /api/wallet/me', async () => {
    const res = await request(app).get('/api/wallet/me').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.data.balance).toBe('number');
  });

  it('GET /api/wallet/ledger is paginated', async () => {
    const res = await request(app).get('/api/wallet/ledger?page=1&limit=10').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 10, total: expect.any(Number) });
  });

  it('GET /api/wallet/ledger', async () => {
    const res = await request(app).get('/api/wallet/ledger').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /api/plans', async () => {
    const res = await request(app).get('/api/plans').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/fund-requests and admin PATCH review', async () => {
    const create = await request(app)
      .post('/api/fund-requests')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        amount: 50_000,
        screenshotUrl: 'https://example.com/payment-proof.png',
        notes: 'integration test',
      });
    expect(create.status).toBe(201);
    const id = create.body.data.id;

    const me = await request(app).get('/api/fund-requests/me').set('Authorization', `Bearer ${userToken}`);
    expect(me.status).toBe(200);
    expect(Array.isArray(me.body.data)).toBe(true);
    expect(me.body.meta).toMatchObject({ page: 1, limit: 20, total: expect.any(Number) });
    expect(me.body.data.some((r) => String(r.id) === String(id))).toBe(true);

    const rev = await request(app)
      .patch(`/api/fund-requests/admin/${id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'approved', approvedAmount: 50_000, reason: 'integration approve' });
    expect(rev.status).toBe(200);

    const wallet = await request(app).get('/api/wallet/me').set('Authorization', `Bearer ${userToken}`);
    expect(wallet.status).toBe(200);
    expect(wallet.body.data.balance).toBe(50_000);
  });

  it('GET /api/package-products and POST /api/packages/purchase (catalog)', async () => {
    const cat = await request(app).get('/api/package-products').set('Authorization', `Bearer ${userToken}`);
    expect(cat.status).toBe(200);
    expect(Array.isArray(cat.body.data)).toBe(true);
    const p2 = cat.body.data.find((p) => p.code === 'P02' && p.amount === 10_000);
    expect(p2).toBeTruthy();
  });

  it('POST /api/packages/purchase and GET /api/packages/me', async () => {
    const buy = await request(app)
      .post('/api/packages/purchase')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ packageCode: 'P02', planCode: 'A' });
    expect(buy.status).toBe(201);

    const pkgs = await request(app).get('/api/packages/me').set('Authorization', `Bearer ${userToken}`);
    expect(pkgs.status).toBe(200);
    expect(pkgs.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/income/trade and /api/income/sponsor', async () => {
    const t = await request(app).get('/api/income/trade').set('Authorization', `Bearer ${userToken}`);
    expect(t.status).toBe(200);
    const s = await request(app).get('/api/income/sponsor').set('Authorization', `Bearer ${userToken}`);
    expect(s.status).toBe(200);
    const m = await request(app).get('/api/income/matching').set('Authorization', `Bearer ${userToken}`);
    expect(m.status).toBe(200);
    expect(Array.isArray(m.body.data)).toBe(true);
  });

  it('GET /api/network/tree', async () => {
    const res = await request(app).get('/api/network/tree?page=1&limit=20').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('myNode');
    expect(res.body.data).toHaveProperty('downline');
    expect(res.body.data.meta).toMatchObject({ page: 1, limit: 20, total: expect.any(Number) });
  });

  it('POST /api/withdrawals enforces eligibility', async () => {
    const res = await request(app)
      .post('/api/withdrawals')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ amount: 999_999 });
    expect(res.status).toBe(400);
  });

  it('GET /api/withdrawals/me and /me/summary', async () => {
    const res = await request(app).get('/api/withdrawals/me').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 20, total: expect.any(Number) });
    const sum = await request(app).get('/api/withdrawals/me/summary').set('Authorization', `Bearer ${userToken}`);
    expect(sum.status).toBe(200);
    expect(typeof sum.body.data.approvedTotal).toBe('number');
  });

  it('admin GET /api/fund-requests/admin and /api/withdrawals/admin', async () => {
    const f = await request(app).get('/api/fund-requests/admin?page=1&limit=10').set('Authorization', `Bearer ${adminToken}`);
    expect(f.status).toBe(200);
    expect(f.body.meta).toMatchObject({ page: 1, limit: 10, total: expect.any(Number) });
    const w = await request(app).get('/api/withdrawals/admin?page=1&limit=10').set('Authorization', `Bearer ${adminToken}`);
    expect(w.status).toBe(200);
    expect(w.body.meta).toMatchObject({ page: 1, limit: 10, total: expect.any(Number) });
    expect(Array.isArray(w.body.data)).toBe(true);
  });

  it('withdrawal POST (after admin credit) → admin approve by publicId or Mongo _id', async () => {
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
    expect(me.status).toBe(200);
    const userCode = me.body.data.id;

    await request(app)
      .put('/api/bank-account/me')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        accountHolderName: 'Test Holder',
        bankName: 'Test Bank',
        accountNumber: '123456789012',
        ifscCode: 'HDFC0001234',
      })
      .expect(200);

    const { User } = require('../src/models');
    const seedUser = await User.findOne({ email: env.seedUserEmail });
    await User.findByIdAndUpdate(seedUser._id, {
      $set: {
        'kyc.status': 'approved',
        'kyc.reviewedAt': new Date(),
        'kyc.reviewReason': 'integration test',
      },
    });

    await request(app)
      .post(`/api/admin/users/${userCode}/credit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 5000, note: 'test credit for withdrawal flow' })
      .expect((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(`Expected 200 or 201 from admin credit, got ${res.status}`);
        }
      });

    const wd = await request(app)
      .post('/api/withdrawals')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ amount: 1000 })
      .expect(201);

    const publicId = wd.body.data.id;
    expect(typeof publicId).toBe('string');
    expect(publicId.length).toBeGreaterThan(3);

    const approveByPublic = await request(app)
      .patch(`/api/withdrawals/admin/${encodeURIComponent(publicId)}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'approved', reason: 'Test payout ok' });
    expect(approveByPublic.status).toBe(200);
    expect(approveByPublic.body.data.status).toBe('approved');

    await request(app)
      .post(`/api/admin/users/${userCode}/credit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 2000, note: 'second credit for mongo id review test' })
      .expect((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(`Expected 200 or 201 from admin credit, got ${res.status}`);
        }
      });

    const wd2 = await request(app)
      .post('/api/withdrawals')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ amount: 500 })
      .expect(201);

    const { WithdrawalRequest } = require('../src/models');
    const raw = await WithdrawalRequest.findOne({ publicId: wd2.body.data.id }).lean();
    expect(raw && raw._id).toBeTruthy();

    const approveByMongo = await request(app)
      .patch(`/api/withdrawals/admin/${String(raw._id)}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'approved', reason: 'Test by ObjectId' });
    expect(approveByMongo.status).toBe(200);
    expect(approveByMongo.body.data.status).toBe('approved');
  });

  it('matching income full flow: first trigger gate, repeated equal events, and real-time payout', async () => {
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
    expect(me.status).toBe(200);
    const u1Referral = me.body.data.referralCode;

    await addFundsAndBuyPackage(userToken, 10_000, 'P02', 'A');

    const u2Token = await registerAndLogin({
      name: 'U2 Right',
      email: 'u2.right@example.com',
      referralCode: u1Referral,
      community: 'right',
    });
    const u3Token = await registerAndLogin({
      name: 'U3 Left',
      email: 'u3.left@example.com',
      referralCode: u1Referral,
      community: 'left',
    });
    await addFundsAndBuyPackage(u2Token, 5_000, 'P01', 'A');
    await addFundsAndBuyPackage(u3Token, 10_000, 'P02', 'A');

    const before = await request(app).get('/api/income/matching').set('Authorization', `Bearer ${userToken}`);
    expect(before.status).toBe(200);
    const beforeCredits = before.body.data.filter((x) => x.status === 'credited').length;

    const u2Me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${u2Token}`);
    const u3Me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${u3Token}`);
    const u4Token = await registerAndLogin({
      name: 'U4 Under U2',
      email: 'u4.under.u2@example.com',
      referralCode: u2Me.body.data.referralCode,
      community: 'right',
    });
    await addFundsAndBuyPackage(u4Token, 5_000, 'P01', 'A');

    const mid = await request(app).get('/api/income/matching').set('Authorization', `Bearer ${userToken}`);
    expect(mid.status).toBe(200);
    const midCredits = mid.body.data.filter((x) => x.status === 'credited').length;
    expect(midCredits).toBeGreaterThanOrEqual(beforeCredits);

    const u5Token = await registerAndLogin({
      name: 'U5 Under U3',
      email: 'u5.under.u3@example.com',
      referralCode: u3Me.body.data.referralCode,
      community: 'left',
    });
    await addFundsAndBuyPackage(u5Token, 10_000, 'P02', 'A');

    const afterFirstEqual = await request(app).get('/api/income/matching').set('Authorization', `Bearer ${userToken}`);
    const firstEqualCredits = afterFirstEqual.body.data.filter((x) => x.status === 'credited').length;
    expect(firstEqualCredits).toBeGreaterThanOrEqual(midCredits);

    const u6Token = await registerAndLogin({
      name: 'U6 Under U2',
      email: 'u6.under.u2@example.com',
      referralCode: u2Me.body.data.referralCode,
      community: 'left',
    });
    await addFundsAndBuyPackage(u6Token, 5_000, 'P01', 'A');

    const u7Token = await registerAndLogin({
      name: 'U7 Under U3',
      email: 'u7.under.u3@example.com',
      referralCode: u3Me.body.data.referralCode,
      community: 'right',
    });
    await addFundsAndBuyPackage(u7Token, 10_000, 'P02', 'A');

    const afterSecondEqual = await request(app).get('/api/income/matching').set('Authorization', `Bearer ${userToken}`);
    const secondEqualCredits = afterSecondEqual.body.data.filter((x) => x.status === 'credited').length;
    expect(secondEqualCredits).toBeGreaterThanOrEqual(firstEqualCredits);
    expect(secondEqualCredits).toBeGreaterThan(beforeCredits);
  });

  it('matching income events keep trigger level bounded to 5 levels', async () => {
    const chain = [];
    let parentToken = userToken;
    for (let i = 0; i < 6; i += 1) {
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${parentToken}`);
      const token = await registerAndLogin({
        name: `Deep User ${i + 1}`,
        email: `deep.user.${i + 1}@example.com`,
        referralCode: me.body.data.referralCode,
        community: i % 2 === 0 ? 'left' : 'right',
      });
      chain.push(token);
      parentToken = token;
    }

    const level6Token = chain[5];
    await addFundsAndBuyPackage(level6Token, 5_000, 'P01', 'A');

    const u1After = await request(app).get('/api/income/matching').set('Authorization', `Bearer ${userToken}`);
    expect(u1After.status).toBe(200);
    expect(u1After.body.data.every((x) => Number(x.triggerLevelFromEarner) <= 5)).toBe(true);
  });

  it('POST /api/kyc/me submits KYC (local storage when Cloudinary unset)', async () => {
    const kycToken = await registerAndLogin({
      name: 'KYC Test User',
      email: 'kyc.test.user@example.com',
      referralCode: (
        await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`)
      ).body.data.referralCode,
      community: 'left',
    });
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const res = await request(app)
      .post('/api/kyc/me')
      .set('Authorization', `Bearer ${kycToken}`)
      .field('accountHolderName', 'Jest User')
      .field('bankName', 'Test Bank')
      .field('accountNumber', '1234567890')
      .field('ifscCode', 'HDFC0001234')
      .field('upiId', '')
      .attach('aadhaar', tinyPng, 'aadhaar.png')
      .attach('passbook', tinyPng, 'passbook.png');
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.documents).toEqual(expect.arrayContaining(['aadhaar', 'passbook']));

    const get = await request(app).get('/api/kyc/me').set('Authorization', `Bearer ${kycToken}`);
    expect(get.status).toBe(200);
    expect(get.body.data.status).toBe('pending');

    const doc = await request(app)
      .get('/api/kyc/me/document/aadhaar')
      .set('Authorization', `Bearer ${kycToken}`);
    expect(doc.status).toBe(200);
    expect(String(doc.headers['content-type'] || '')).toMatch(/image\//);
  });

  it('admin PATCH /api/admin/kyc/:userCode/review approves unverified user when admin provides bank details', async () => {
    const directToken = await registerAndLogin({
      name: 'Direct KYC User',
      email: 'direct.kyc.user@example.com',
      referralCode: (
        await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`)
      ).body.data.referralCode,
      community: 'left',
    });
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${directToken}`);
    const userCode = me.body.data.userCode;

    const approve = await request(app)
      .patch(`/api/admin/kyc/${userCode}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        status: 'approved',
        accountHolderName: 'Direct User',
        bankName: 'Test Bank',
        accountNumber: '9988776655',
        ifscCode: 'HDFC0001234',
      });
    expect(approve.status).toBe(200);
    expect(approve.body.data.kyc.status).toBe('approved');

    const kyc = await request(app).get('/api/kyc/me').set('Authorization', `Bearer ${directToken}`);
    expect(kyc.status).toBe(200);
    expect(kyc.body.data.status).toBe('approved');

    const bank = await request(app).get('/api/bank-account/me').set('Authorization', `Bearer ${directToken}`);
    expect(bank.status).toBe(200);
    expect(bank.body.data.isComplete).toBe(true);
    expect(bank.body.data.accountNumberMasked).toMatch(/6655$/);
  });

  it('admin direct KYC approval still works when member already saved bank details', async () => {
    const directToken = await registerAndLogin({
      name: 'Direct KYC Existing Bank User',
      email: 'direct.kyc.existing.bank@example.com',
      referralCode: (
        await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`)
      ).body.data.referralCode,
      community: 'left',
    });
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${directToken}`);
    const userCode = me.body.data.userCode;

    await request(app)
      .put('/api/bank-account/me')
      .set('Authorization', `Bearer ${directToken}`)
      .send({
        accountHolderName: 'Direct User',
        bankName: 'Test Bank',
        accountNumber: '9988776655',
        ifscCode: 'HDFC0001234',
      })
      .expect(200);

    const approve = await request(app)
      .patch(`/api/admin/kyc/${userCode}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'approved' });
    expect(approve.status).toBe(200);
    expect(approve.body.data.kyc.status).toBe('approved');
  });

  it('admin direct KYC approval fails when bank details are missing', async () => {
    const noBankToken = await registerAndLogin({
      name: 'No Bank KYC User',
      email: 'no.bank.kyc.user@example.com',
      referralCode: (
        await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`)
      ).body.data.referralCode,
      community: 'right',
    });
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${noBankToken}`);
    const userCode = me.body.data.userCode;

    const approve = await request(app)
      .patch(`/api/admin/kyc/${userCode}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'approved' });
    expect(approve.status).toBe(400);
    expect(String(approve.body.message || '')).toMatch(/bank/i);
  });

  it('admin PATCH /api/admin/kyc/:userCode/review still approves pending submissions', async () => {
    const pendingToken = await registerAndLogin({
      name: 'Pending KYC User',
      email: 'pending.kyc.user@example.com',
      referralCode: (
        await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`)
      ).body.data.referralCode,
      community: 'left',
    });
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${pendingToken}`);
    const userCode = me.body.data.userCode;
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );

    const submit = await request(app)
      .post('/api/kyc/me')
      .set('Authorization', `Bearer ${pendingToken}`)
      .field('accountHolderName', 'Pending User')
      .field('bankName', 'Test Bank')
      .field('accountNumber', '1122334455')
      .field('ifscCode', 'HDFC0001234')
      .field('upiId', '')
      .attach('aadhaar', tinyPng, 'aadhaar.png')
      .attach('passbook', tinyPng, 'passbook.png');
    expect(submit.status).toBe(201);
    expect(submit.body.data.status).toBe('pending');

    const approve = await request(app)
      .patch(`/api/admin/kyc/${userCode}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'approved', reason: 'Documents verified.' });
    expect(approve.status).toBe(200);
    expect(approve.body.data.kyc.status).toBe('approved');
  });

  it('admin cannot reject unverified KYC without a pending submission', async () => {
    const rejectToken = await registerAndLogin({
      name: 'Reject Unverified User',
      email: 'reject.unverified.kyc@example.com',
      referralCode: (
        await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`)
      ).body.data.referralCode,
      community: 'right',
    });
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${rejectToken}`);
    const userCode = me.body.data.userCode;

    const reject = await request(app)
      .patch(`/api/admin/kyc/${userCode}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'rejected', reason: 'Should not work' });
    expect(reject.status).toBe(400);
  });
});
