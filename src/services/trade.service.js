const { Plan, PackageProduct, PackageSubscription, HolidayCalendar, TradeCreditEvent, AuditLog, TradeJobRun } = require('../models');
const { debitWallet, creditWallet } = require('./wallet.service');
const { addIstDays, toIstDateParts, isWeekendFromIstIso, istDateCompare } = require('../utils/date-utils');
const { recalculateEligibilityForAllPortfolioUsers } = require('./eligibility.service');
const { AppError } = require('../utils/errors');

function getCycleNumber(withdrawalDay1Ist, currentIstDate, w) {
  const a = new Date(`${withdrawalDay1Ist}T00:00:00.000Z`);
  const b = new Date(`${currentIstDate}T00:00:00.000Z`);
  const diff = Math.floor((b - a) / (1000 * 60 * 60 * 24));
  return Math.floor(diff / w) + 1;
}

async function purchasePackage({ userId, planCode, packageCode }) {
  const plan = await Plan.findOne({ code: planCode, isActive: true });
  if (!plan) throw new AppError(404, 'Plan not found');
  const product = await PackageProduct.findOne({ code: packageCode, isActive: true });
  if (!product) throw new AppError(404, 'Package not found or inactive');
  const amount = Number(product.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError(400, 'Invalid package amount');
  await debitWallet({
    userId,
    amount,
    contextType: 'package_purchase',
    notes: `Package ${product.code} — plan ${plan.code}`,
  });

  const now = new Date();
  const { isoDate: purchaseDateIst } = toIstDateParts(now);
  const withdrawalDay1Ist = addIstDays(purchaseDateIst, 1);

  let firstEarningDateIst = withdrawalDay1Ist;
  while (true) {
    const isWeekend = isWeekendFromIstIso(firstEarningDateIst);
    const holiday = await HolidayCalendar.findOne({ dateIst: firstEarningDateIst });
    if (!isWeekend && !holiday) break;
    firstEarningDateIst = addIstDays(firstEarningDateIst, 1);
  }

  return PackageSubscription.create({
    userId,
    planId: plan._id,
    principalAmount: amount,
    purchaseDateIst,
    purchaseAtUtc: now,
    withdrawalDay1Ist,
    firstEarningDateIst,
  });
}

async function runDailyTradeCredits(forIstDate = null) {
  const todayIst = forIstDate || toIstDateParts(new Date()).isoDate;
  const isWeekend = isWeekendFromIstIso(todayIst);
  if (isWeekend) {
    await recalculateEligibilityForAllPortfolioUsers(todayIst);
    return { date: todayIst, skipped: true, reason: 'weekend' };
  }

  const holiday = await HolidayCalendar.findOne({ dateIst: todayIst });
  if (holiday) {
    await recalculateEligibilityForAllPortfolioUsers(todayIst);
    return { date: todayIst, skipped: true, reason: 'holiday' };
  }

  const alreadyDone = await TradeJobRun.findOne({ dayIst: todayIst, finished: true });
  if (alreadyDone) {
    await recalculateEligibilityForAllPortfolioUsers(todayIst);
    return { date: todayIst, skipped: true, reason: 'trade_job_already_finished', processed: alreadyDone.processed };
  }

  const activeSubs = await PackageSubscription.find({ status: 'active' }).populate('planId');
  let processed = 0;

  for (const sub of activeSubs) {
    if (sub.workingDaysCredited >= sub.planId.maxWorkingDaysN) {
      sub.status = 'completed';
      sub.completedAtUtc = new Date();
      await sub.save();
      continue;
    }

    if (istDateCompare(todayIst, sub.firstEarningDateIst) < 0) {
      continue;
    }

    const existing = await TradeCreditEvent.findOne({ packageSubscriptionId: sub._id, creditDateIst: todayIst });
    if (existing) continue;

    const amount = Number(((sub.principalAmount * sub.planId.dailyPercent) / 100).toFixed(2));
    const cycleNumber = getCycleNumber(sub.withdrawalDay1Ist, todayIst, sub.planId.cycleDaysW);

    await TradeCreditEvent.create({
      userId: sub.userId,
      packageSubscriptionId: sub._id,
      cycleNumber,
      creditDateIst: todayIst,
      amount,
    });

    await creditWallet({
      userId: sub.userId,
      amount,
      contextType: 'trade_income',
      contextId: sub._id,
      packageSubscriptionId: sub._id,
      notes: `Daily trade income on ${todayIst}`,
      metadata: { cycleNumber, planCode: sub.planId.code },
    });

    sub.workingDaysCredited += 1;
    if (sub.workingDaysCredited >= sub.planId.maxWorkingDaysN) {
      sub.status = 'completed';
      sub.completedAtUtc = new Date();
    }
    await sub.save();
    processed += 1;
  }

  await AuditLog.create({ action: 'daily_trade_credit_job', targetType: 'System', details: { date: todayIst, processed } });

  await recalculateEligibilityForAllPortfolioUsers(todayIst);

  await TradeJobRun.findOneAndUpdate(
    { dayIst: todayIst },
    { $set: { finished: true, processed }, $setOnInsert: { dayIst: todayIst } },
    { upsert: true }
  );

  return { date: todayIst, skipped: false, processed };
}

module.exports = { purchasePackage, runDailyTradeCredits, getCycleNumber };
