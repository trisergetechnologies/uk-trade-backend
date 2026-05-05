const { z } = require('./validate');

const mobileNumberSchema = z
  .string()
  .trim()
  .min(7)
  .max(20)
  .regex(/^[0-9+\-() ]+$/, 'Invalid mobile number format');

const registerSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
    mobileNumber: mobileNumberSchema,
    referralCode: z.string().min(3),
    community: z.enum(['left', 'right']),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

const referrerLookupSchema = z.object({
  query: z.object({
    code: z.string().trim().min(3).max(64),
  }),
  params: z.object({}).optional(),
  body: z.object({}).optional(),
});

const loginSchema = z.object({
  body: z.object({ email: z.string().email(), password: z.string().min(6) }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

const changePasswordSchema = z.object({
  body: z
    .object({
      currentPassword: z.string().min(6),
      newPassword: z.string().min(8),
      confirmPassword: z.string().min(8),
    })
    .superRefine((v, ctx) => {
      if (v.newPassword !== v.confirmPassword) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmPassword'], message: 'Passwords do not match' });
      }
      if (v.currentPassword === v.newPassword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['newPassword'],
          message: 'New password must be different from current password',
        });
      }
    }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

module.exports = { registerSchema, loginSchema, changePasswordSchema, referrerLookupSchema };
