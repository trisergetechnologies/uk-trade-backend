const { z } = require('./validate');

const updateMeSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(80).optional(),
    email: z.string().email().optional(),
    preferredCommunity: z.enum(['left', 'right']).optional(),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

module.exports = { updateMeSchema };
