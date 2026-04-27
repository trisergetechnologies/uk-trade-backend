const express = require('express');
const { register, login, me, updateMe } = require('../controllers/auth.controller');
const { validate } = require('../validators/validate');
const { registerSchema, loginSchema } = require('../validators/auth.validator');
const { updateMeSchema } = require('../validators/profile.validator');
const { authRequired } = require('../middlewares/auth.middleware');

const router = express.Router();

router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.get('/me', authRequired, me);
router.put('/me', authRequired, validate(updateMeSchema), updateMe);

module.exports = router;
