const request = require('supertest');
const app = require('../src/app');

describe('Backend health', () => {
  it('returns health payload', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
