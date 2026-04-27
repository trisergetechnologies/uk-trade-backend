const express = require('express');
const { authRequired } = require('../middlewares/auth.middleware');
const { validate } = require('../validators/validate');
const { placeSelfSchema } = require('../validators/network.validator');
const { myTree, placeSelf, myTeamSummary, myTeamMembers, myTeamTree, myTeamTreeChildren, myTeamFocusWindow } = require('../controllers/network.controller');

const router = express.Router();

router.get('/tree', authRequired, myTree);
router.get('/team/summary', authRequired, myTeamSummary);
router.get('/team/members', authRequired, myTeamMembers);
router.get('/team/tree', authRequired, myTeamTree);
router.get('/team/tree/children', authRequired, myTeamTreeChildren);
router.get('/team/tree/focus', authRequired, myTeamFocusWindow);
router.post('/place', authRequired, validate(placeSelfSchema), placeSelf);

module.exports = router;
