const { z } = require('./validate');

const createFundTransferSchema = z.object({
  body: z.object({
    toUserCode: z.string().trim().min(3).max(32),
    amount: z.number().positive(),
    note: z.string().trim().max(500).optional(),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

module.exports = { createFundTransferSchema };
