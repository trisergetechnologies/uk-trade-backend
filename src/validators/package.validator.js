const { z } = require('./validate');

const purchasePackageSchema = z.object({
  body: z.object({
    planCode: z.enum(['A', 'B', 'C', 'D']),
    packageCode: z.string().min(1).max(32),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

module.exports = { purchasePackageSchema };
