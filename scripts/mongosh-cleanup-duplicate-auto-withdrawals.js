/**
 * One-shot mongosh cleanup for duplicate auto-withdraw bug traces.
 *
 * Usage (mongosh):
 *   use uk-trade-migration-v2
 *   load("scripts/mongosh-cleanup-duplicate-auto-withdrawals.js")
 *
 * Or paste sections below after switching to the correct database.
 */

const USER_ID = '6a257d9496d6e933628f13ee';
const AMOUNT = 57500;

print('Database:', db.getName());
print('Collections:', db.getCollectionNames().filter((n) => /withdraw|audit/i.test(n)));

const autoLogFilter = {
  action: 'withdrawal_request_auto_created',
  'details.reason': 'trade_cycle_unlock',
  'details.userId': USER_ID,
  'details.amount': AMOUNT,
};

const logCount = db.auditlogs.countDocuments(autoLogFilter);
print('Auto audit logs for user+amount:', logCount);

if (logCount < 2) {
  print('Nothing to clean (need 2+ audit logs). Check USER_ID, AMOUNT, and database name.');
  print('All auto logs for user:', db.auditlogs.countDocuments({
    action: 'withdrawal_request_auto_created',
    'details.userId': USER_ID,
  }));
  print('Pending withdrawals for user:', db.withdrawalrequests.countDocuments({
    userId: ObjectId(USER_ID),
    status: 'pending',
  }));
  quit(0);
}

const logs = db.auditlogs.find(autoLogFilter).sort({ createdAt: 1 }).toArray();
const keepLog = logs[0];
const removeLogIds = logs.slice(1).map((l) => l._id);
const removeWdIds = [...new Set(logs.slice(1).map((l) => l.targetId).filter(Boolean))];

print('Keeping withdrawal:', keepLog.targetId, 'from', keepLog.createdAt);
print('Deleting withdrawals:', removeWdIds.length, 'audit logs:', removeLogIds.length);

const wdResult = db.withdrawalrequests.deleteMany({ _id: { $in: removeWdIds } });
const logResult = db.auditlogs.deleteMany({ _id: { $in: removeLogIds } });

printjson({ deletedWithdrawals: wdResult.deletedCount, deletedAuditLogs: logResult.deletedCount });

print('Remaining pending for amount:',
  db.withdrawalrequests.countDocuments({
    userId: ObjectId(USER_ID),
    amount: AMOUNT,
    status: 'pending',
  })
);
