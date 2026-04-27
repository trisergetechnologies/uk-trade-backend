const mongoose = require('mongoose');

const holidayCalendarSchema = new mongoose.Schema(
  {
    exchange: { type: String, required: true, default: 'NSE' },
    dateIst: { type: String, required: true },
    reason: { type: String, default: '' },
  },
  { timestamps: true }
);

holidayCalendarSchema.index({ exchange: 1, dateIst: 1 }, { unique: true });

module.exports = mongoose.model('HolidayCalendar', holidayCalendarSchema);
