import { initializeMonitoring, redactEvent } from './observability';
describe('browser monitoring privacy', () => {
  it('does not enable tracking without runtime DSN', () => expect(initializeMonitoring({})).toBeFalse());
  it('retains locations but removes arbitrary sensitive fields', () => {
    const result = redactEvent({ type: undefined, request: { url: 'https://example.test/?secret=hidden', data: 'private' }, breadcrumbs: [{ message: 'secret' }], extra: { password: 'secret' }, exception: { values: [{ type: 'Error', value: 'SQL customer private', stacktrace: { frames: [{ filename: 'https://example.test/main.js?token=secret', lineno: 42, vars: { phone: 'private' } }] } }] } });
    expect(JSON.stringify(result)).not.toMatch(/secret|private/);
    expect(result.exception?.values?.[0].stacktrace?.frames?.[0].lineno).toBe(42);
  });
});
