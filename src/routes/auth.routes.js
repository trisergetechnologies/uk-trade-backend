const express = require('express');
const { register, login, me, updateMe, updateMyPassword, referrerLookup } = require('../controllers/auth.controller');
const { validate } = require('../validators/validate');
const { registerSchema, loginSchema, changePasswordSchema, referrerLookupSchema } = require('../validators/auth.validator');
const { updateMeSchema } = require('../validators/profile.validator');
const { authRequired } = require('../middlewares/auth.middleware');

const router = express.Router();

router.post('/register', validate(registerSchema), register);
router.get('/referrer-lookup', validate(referrerLookupSchema), referrerLookup);
router.post('/login', validate(loginSchema), login);
router.get('/me', authRequired, me);
router.put('/me', authRequired, validate(updateMeSchema), updateMe);
router.patch('/me/password', authRequired, validate(changePasswordSchema), updateMyPassword);

module.exports = router;
