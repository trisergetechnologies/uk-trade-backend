const express = require('express');
const { authRequired, allowRoles } = require('../middlewares/auth.middleware');
const { ROLES } = require('../constants/roles');
const { validate } = require('../validators/validate');
const { createHolidaySchema } = require('../validators/holiday.validator');
const { listHolidays, createHoliday, deleteHoliday } = require('../controllers/holiday.controller');

const router = express.Router();

router.get('/', authRequired, allowRoles(ROLES.ADMIN), listHolidays);
router.post('/', authRequired, allowRoles(ROLES.ADMIN), validate(createHolidaySchema), createHoliday);
router.delete('/:dateIst', authRequired, allowRoles(ROLES.ADMIN), deleteHoliday);

module.exports = router;
