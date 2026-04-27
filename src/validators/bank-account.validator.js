const { z } = require('./validate');

const updateBankAccountSchema = z.object({
  body: z.object({
    accountHolderName: z.string().trim().min(2).max(100),
    bankName: z.string().trim().min(2).max(100),
    accountNumber: z.string().trim().min(6).max(34),
    ifscCode: z.string().trim().min(4).max(20),
    upiId: z.string().trim().min(3).max(100).optional().or(z.literal('')),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

module.exports = { updateBankAccountSchema };
