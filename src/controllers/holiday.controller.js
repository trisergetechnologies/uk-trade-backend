const { HolidayCalendar } = require('../models');
const { parsePagination, metaFor } = require('../utils/pagination');
const { AppError } = require('../utils/errors');

async function listHolidays(req, res, next) {
  try {
    const { page, limit, skip } = parsePagination(req);
    const [rows, total] = await Promise.all([
      HolidayCalendar.find().sort({ dateIst: -1 }).skip(skip).limit(limit),
      HolidayCalendar.countDocuments({}),
    ]);
    res.json({ success: true, data: rows, meta: metaFor(page, limit, total) });
  } catch (error) {
    next(error);
  }
}

async function createHoliday(req, res, next) {
  try {
    const { dateIst, reason = '', exchange = 'NSE' } = req.validated.body;
    const row = await HolidayCalendar.findOneAndUpdate(
      { exchange, dateIst },
      { exchange, dateIst, reason },
      { upsert: true, returnDocument: 'after' }
    );
    res.status(201).json({ success: true, data: row });
  } catch (error) {
    next(error);
  }
}

async function deleteHoliday(req, res, next) {
  try {
    const dateIst = req.params.dateIst;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIst)) throw new AppError(400, 'Invalid dateIst');
    const result = await HolidayCalendar.findOneAndDelete({ dateIst });
    if (!result) throw new AppError(404, 'Holiday not found');
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

module.exports = { listHolidays, createHoliday, deleteHoliday };
