const { ROLES } = require('../constants/roles');

/**
 * Binary tree placement, sponsor income, and matching uplines use this.
 * Admins keep normal login but never participate in the member network graph or those incomes.
 */
function isNetworkParticipant(user) {
  if (!user) return false;
  return user.role === ROLES.USER;
}

module.exports = { isNetworkParticipant };
