module.exports = app => {
  app.use(require('./calendar.routes'));
  app.use(require('./settings.routes'));
  app.use(require('./auth.routes'));
  app.use(require('./bookings.routes'));
  app.use(require('./recurring.routes'));
  app.use(require('./admin-bookings.routes'));
  app.use(require('./slots.routes'));
  app.use(require('./slot-blocks.routes'));
  app.use(require('./stats.routes'));
  app.use(require('./payments.routes'));
};
