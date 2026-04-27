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
});
