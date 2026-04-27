const { z } = require('./validate');

const createHolidaySchema = z.object({
  body: z.object({
    dateIst: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().max(500).optional(),
    exchange: z.string().max(20).optional(),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

module.exports = { createHolidaySchema };
