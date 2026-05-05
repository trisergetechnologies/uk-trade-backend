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

const planPatchBody = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  dailyPercent: z.number().positive().max(100).optional(),
  cycleDaysW: z.number().int().positive().max(365).optional(),
  maxWorkingDaysN: z.number().int().positive().max(5000).optional(),
  sponsorPercent: z.number().min(0).max(100).optional(),
  summary: z.string().max(400).optional(),
  detailHelp: z.string().max(3000).optional(),
  isActive: z.boolean().optional(),
});

const adminPatchPlanSchema = z
  .object({
    params: z.object({
      code: z
        .string()
        .trim()
        .min(1)
        .max(20)
        .transform((s) => s.toUpperCase()),
    }),
    query: z.object({}).optional(),
    body: planPatchBody,
  })
  .refine((d) => Object.keys(d.body).length > 0, {
    path: ['body'],
    message: 'At least one field is required',
  });

const packagePatchBody = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  amount: z.number().positive().optional(),
  shortDescription: z.string().max(400).optional(),
  detailHelp: z.string().max(3000).optional(),
  features: z.array(z.string().trim().min(1).max(150)).max(20).optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
});

const adminPatchPackageSchema = z
  .object({
    params: z.object({
      code: z
        .string()
        .trim()
        .min(1)
        .max(20)
        .transform((s) => s.toUpperCase()),
    }),
    query: z.object({}).optional(),
    body: packagePatchBody,
  })
  .refine((d) => Object.keys(d.body).length > 0, {
    path: ['body'],
    message: 'At least one field is required',
  });

const adminLookupUserParamSchema = z.object({
  params: z.object({ userCode: z.string().min(3).max(64).transform((s) => String(s).toUpperCase()) }),
  body: z.object({}).optional(),
  query: z.object({}).optional(),
});

const adminCreditWalletSchema = z.object({
  params: z.object({ userCode: z.string().min(3).max(64).transform((s) => String(s).toUpperCase()) }),
  body: z.object({
    amount: z.number().positive(),
    note: z.string().max(500).optional(),
  }),
  query: z.object({}).optional(),
});

const adminPurchaseOnBehalfSchema = z.object({
  params: z.object({ userCode: z.string().min(3).max(64).transform((s) => String(s).toUpperCase()) }),
  body: z.object({
    planCode: z.string().trim().min(1).max(20).transform((s) => String(s).toUpperCase()),
    packageCode: z.string().trim().min(1).max(20).transform((s) => String(s).toUpperCase()),
  }),
  query: z.object({}).optional(),
});

const adminCommunityUsersSchema = z.object({
  query: z.object({
    community: z.enum(['left', 'right']),
    q: z.string().optional(),
  }),
  params: z.object({}).optional(),
  body: z.object({}).optional(),
});

const adminUserTeamTreeSchema = z.object({
  params: z.object({
    userCode: z.string().min(3).max(64).transform((s) => String(s).toUpperCase()),
  }),
  query: z.object({
    depth: z.string().optional(),
    nodes: z.string().optional(),
  }),
  body: z.object({}).optional(),
});

const adminUserTeamTreeChildrenSchema = z.object({
  params: z.object({
    userCode: z.string().min(3).max(64).transform((s) => String(s).toUpperCase()),
  }),
  query: z.object({
    parentUserCode: z.string().min(3).max(64).transform((s) => String(s).toUpperCase()),
    limit: z.string().optional(),
  }),
  body: z.object({}).optional(),
});

const adminUserTeamFocusSchema = z.object({
  params: z.object({
    userCode: z.string().min(3).max(64).transform((s) => String(s).toUpperCase()),
  }),
  query: z.object({
    targetUserCode: z.string().trim().max(64).optional(),
  }),
  body: z.object({}).optional(),
});

module.exports = {
  adminUserCodeParamSchema,
  adminSetUserStatusSchema,
  adminMediaPaymentProofSchema,
  adminCreatePlanSchema,
  adminCreatePackageSchema,
  adminPatchPlanSchema,
  adminPatchPackageSchema,
  adminLookupUserParamSchema,
  adminCreditWalletSchema,
  adminPurchaseOnBehalfSchema,
  adminCommunityUsersSchema,
  adminUserTeamTreeSchema,
  adminUserTeamTreeChildrenSchema,
  adminUserTeamFocusSchema,
};
