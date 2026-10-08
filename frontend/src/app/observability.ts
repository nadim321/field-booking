import { captureException, init } from '@sentry/angular';
import type { ErrorEvent } from '@sentry/angular';

export function redactEvent(event: ErrorEvent): ErrorEvent {
  return {
    type: undefined,
    event_id: event.event_id, timestamp: event.timestamp, platform: event.platform,
    level: event.level, release: event.release, environment: event.environment,
    exception: event.exception ? { values: event.exception.values?.map(value => ({
      type: /^(Error|TypeError|RangeError|SyntaxError|ReferenceError|URIError|EvalError)$/.test(value.type || '') ? value.type : 'Error',
      value: 'Application operation failed (details withheld)',
      stacktrace: value.stacktrace ? { frames: value.stacktrace.frames?.map(frame => ({
        filename: frame.filename?.split(/[?#]/)[0], function: frame.function,
        lineno: frame.lineno, colno: frame.colno, in_app: frame.in_app
      })) } : undefined
    })) } : undefined,
    debug_meta: event.debug_meta
  };
}

export function initializeMonitoring(config = window.__BOOKING_RUNTIME_CONFIG__): boolean {
  if (!config?.sentryDsn) return false;
  init({
    dsn: config.sentryDsn, environment: config.environment || 'production', release: config.release,
    sendDefaultPii: false, tracesSampleRate: 0,
    integrations: defaults => defaults.filter(integration => !['Breadcrumbs', 'BrowserSession'].includes(integration.name)),
    beforeSend: redactEvent
  });
  return true;
}
export function reportBootstrapError(error: unknown): void {
  captureException(error);
  console.error('Application could not start');
}
