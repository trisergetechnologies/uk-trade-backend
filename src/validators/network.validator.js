const { z } = require('./validate');

const placeSelfSchema = z.object({
  body: z.object({ community: z.enum(['left', 'right']) }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

module.exports = { placeSelfSchema };
