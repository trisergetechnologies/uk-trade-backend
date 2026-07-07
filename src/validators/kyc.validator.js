const { z } = require('./validate');

const submitKycSchema = z.object({
  body: z
    .object({
      accountHolderName: z.string().trim().min(2).max(100),
      bankName: z.string().trim().min(2).max(100),
      accountNumber: z.string().trim().min(6).max(34),
      ifscCode: z.string().trim().min(4).max(20),
      upiId: z.string().trim().min(3).max(100).optional().or(z.literal('')),
    })
    .passthrough(),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

const kycDocumentKindEnum = z.enum([
  'aadhaar',
  'passbook',
  'aadhaarFront',
  'aadhaarBack',
  'pan',
  'photo',
]);

const myKycDocumentSchema = z.object({
  params: z.object({ kind: kycDocumentKindEnum }),
  body: z.object({}).optional(),
  query: z.object({}).optional(),
});

const adminListKycSchema = z.object({
  query: z
    .object({
      status: z.enum(['pending', 'approved', 'rejected', 'unverified', 'all']).optional(),
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
      q: z.string().optional(),
    })
    .passthrough(),
  body: z.object({}).optional(),
  params: z.object({}).optional(),
});

const adminReviewKycSchema = z.object({
  params: z.object({ userCode: z.string().min(3).max(64).transform((s) => String(s).toUpperCase()) }),
  body: z
    .object({
      status: z.enum(['approved', 'rejected']),
      reason: z.string().trim().max(2000).optional().or(z.literal('')),
      accountHolderName: z.string().trim().min(2).max(100).optional().or(z.literal('')),
      bankName: z.string().trim().min(2).max(100).optional().or(z.literal('')),
      accountNumber: z.string().trim().min(6).max(34).optional().or(z.literal('')),
      ifscCode: z.string().trim().min(4).max(20).optional().or(z.literal('')),
      upiId: z.string().trim().min(3).max(100).optional().or(z.literal('')),
    })
    .superRefine((data, ctx) => {
      if (data.status === 'rejected' && (!data.reason || data.reason.trim().length < 2)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'A rejection reason is required',
          path: ['reason'],
        });
      }
    }),
  query: z.object({}).optional(),
});

const adminKycMediaSchema = z.object({
  params: z.object({
    userCode: z.string().min(3).max(64).transform((s) => String(s).toUpperCase()),
    kind: kycDocumentKindEnum,
  }),
  body: z.object({}).optional(),
  query: z.object({}).optional(),
});

module.exports = {
  submitKycSchema,
  myKycDocumentSchema,
  adminListKycSchema,
  adminReviewKycSchema,
  adminKycMediaSchema,
};
