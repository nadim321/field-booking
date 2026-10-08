const { randomUUID } = require('node:crypto');
const logger = require('../utils/logger');
const sentry = require('../observability/sentry');

function reportError(error, req) {
  if (req.sentryReported) return;
  req.sentryReported = true;
  const tags = { request_id: req.requestId, 'http.method': req.method, 'http.route': req.route?.path || 'unmatched' };
  logger.error('request_error', { ...tags, error_type: error instanceof TypeError ? 'TypeError' : 'Error' });
  sentry.captureException(error, tags);
}
exports.reportError = reportError;
exports.requestLog = (req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  // Callback-based controllers can forward errors without losing their original stack.
  res.fail = error => next(error);
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    if (res.statusCode >= 500 && req.route?.path !== '/health/ready') reportError(new Error('Unhandled HTTP failure'), req);
    const fields = { request_id: req.requestId, method: req.method, route: req.route?.path || 'unmatched', status: res.statusCode, duration_ms: Number(process.hrtime.bigint() - started) / 1e6 };
    (res.statusCode >= 500 ? logger.error : logger.info)('http_request', fields);
  });
  const json = res.json.bind(res);
  res.json = body => json(res.statusCode >= 500 && req.route?.path !== '/health/ready'
    ? { message: 'The request could not be completed. Please try again.', request_id: req.requestId } : body);
  next();
};
exports.errorHandler = (error, req, res, next) => {
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
  if (status >= 500) reportError(error, req);
  if (res.headersSent) return next(error);
  const message = status >= 500 ? 'Internal server error' : error.type === 'entity.parse.failed' ? 'Invalid request body' : status === 413 ? 'Request body too large' : error.message;
  res.status(status).json({ message, request_id: req.requestId });
};
