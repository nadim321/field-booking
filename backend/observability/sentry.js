const Sentry = require('@sentry/node');
const { release } = require('../config/release');
let enabled = false;

// Allowlisted diagnostics retain stack locations without serializing customer data,
// SQL messages, URLs, credentials, locals, breadcrumbs or arbitrary error properties.
function redactEvent(event) {
  const tags = {};
  for (const key of ['request_id', 'http.method', 'http.route', 'stage']) {
    if (event.tags?.[key]) tags[key] = event.tags[key];
  }
  return {
    event_id: event.event_id, timestamp: event.timestamp, platform: event.platform,
    level: event.level, release: event.release, environment: event.environment,
    tags,
    exception: event.exception ? { values: event.exception.values?.map(value => ({
      type: /^(Error|TypeError|RangeError|SyntaxError|ReferenceError|URIError|EvalError)$/.test(value.type) ? value.type : 'Error',
      value: 'Application operation failed (details withheld)',
      stacktrace: value.stacktrace ? { frames: value.stacktrace.frames?.map(frame => ({
        filename: frame.filename?.split(/[?#]/)[0], function: frame.function,
        lineno: frame.lineno, colno: frame.colno, in_app: frame.in_app
      })) } : undefined
    })) } : undefined,
    debug_meta: event.debug_meta
  };
}
function initialize(config = process.env, options = {}) {
  if (!config.SENTRY_DSN || enabled) return false;
  Sentry.init({
    dsn: config.SENTRY_DSN, environment: config.SENTRY_ENVIRONMENT || config.NODE_ENV || 'development',
    release, sendDefaultPii: false, tracesSampleRate: 0,
    defaultIntegrations: false,
    integrations: [Sentry.onUncaughtExceptionIntegration(), Sentry.onUnhandledRejectionIntegration()],
    beforeSend: redactEvent,
    ...options
  });
  enabled = true;
  return true;
}
function captureException(error, tags = {}) {
  if (!enabled) return;
  return Sentry.withScope(scope => {
    for (const [key, value] of Object.entries(tags)) scope.setTag(key, value);
    return Sentry.captureException(error);
  });
}
async function flush() {
  if (enabled) await Sentry.flush(2000);
}
module.exports = { initialize, captureException, redactEvent, flush, isEnabled: () => enabled };
