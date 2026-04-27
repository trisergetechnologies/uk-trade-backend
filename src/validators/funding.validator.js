const { z } = require('./validate');

const createFundRequestSchema = z.object({
  body: z.object({
    amount: z.number().positive(),
    screenshotUrl: z.string().min(3).max(2_000_000),
    notes: z.string().optional(),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

const adminReviewFundSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    status: z.enum(['approved', 'rejected']),
    approvedAmount: z.number().positive().optional(),
    reason: z.string().max(2000).optional(),
  }),
  query: z.object({}).optional(),
});

const adminGetFundRequestSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({}).optional(),
  query: z.object({}).optional(),
});

module.exports = { createFundRequestSchema, adminReviewFundSchema, adminGetFundRequestSchema };
