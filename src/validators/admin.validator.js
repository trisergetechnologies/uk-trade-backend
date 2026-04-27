const { z } = require('./validate');

const adminUserCodeParamSchema = z.object({
  params: z.object({ userCode: z.string().min(3).max(64).toUpperCase() }),
  body: z.object({}).optional(),
  query: z.object({}).optional(),
});

const adminSetUserStatusSchema = z.object({
  params: z.object({ userCode: z.string().min(3).max(64).toUpperCase() }),
  body: z.object({ isActive: z.boolean() }),
  query: z.object({}).optional(),
});

const adminMediaPaymentProofSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({}).optional(),
  query: z.object({}).optional(),
});

const adminCreatePlanSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z.object({
    code: z.string().trim().min(1).max(20).toUpperCase(),
    name: z.string().trim().min(2).max(120),
    dailyPercent: z.number().positive().max(100),
    cycleDaysW: z.number().int().positive().max(365),
    maxWorkingDaysN: z.number().int().positive().max(5000),
    sponsorPercent: z.number().min(0).max(100).optional(),
    summary: z.string().max(400).optional(),
    detailHelp: z.string().max(3000).optional(),
    isActive: z.boolean().optional(),
  }),
});

const adminCreatePackageSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z.object({
    code: z.string().trim().min(1).max(20).toUpperCase(),
    name: z.string().trim().min(2).max(120),
    amount: z.number().positive(),
    shortDescription: z.string().max(400).optional(),
    detailHelp: z.string().max(3000).optional(),
    features: z.array(z.string().trim().min(1).max(150)).max(20).optional(),
    sortOrder: z.number().int().min(0).max(100000).optional(),
    isActive: z.boolean().optional(),
  }),
});

module.exports = {
  adminUserCodeParamSchema,
  adminSetUserStatusSchema,
  adminMediaPaymentProofSchema,
  adminCreatePlanSchema,
  adminCreatePackageSchema,
};
