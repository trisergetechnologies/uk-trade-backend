const { z } = require('./validate');

const withdrawalRequestSchema = z.object({
  body: z.object({ amount: z.number().positive() }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

const adminReviewWithdrawalSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({ status: z.enum(['approved', 'rejected']), reason: z.string().optional() }),
  query: z.object({}).optional(),
});

module.exports = { withdrawalRequestSchema, adminReviewWithdrawalSchema };
