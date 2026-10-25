import { resolveApiBaseUrl } from './api-base-url';

describe('resolveApiBaseUrl', () => {
  it('uses the configured development backend URL', () => {
    expect(resolveApiBaseUrl('http://localhost:5000/api')).toBe('http://localhost:5000/api');
  });

  it('normalizes the configured production URL', () => {
    expect(resolveApiBaseUrl('https://field-booking-back.onrender.com/api/'))
      .toBe('https://field-booking-back.onrender.com/api');
  });

  it('accepts a same-origin API path and removes a trailing slash', () => {
    expect(resolveApiBaseUrl('/api/')).toBe('/api');
  });

  it('rejects a missing URL instead of silently using a fallback', () => {
    expect(() => resolveApiBaseUrl('  ')).toThrowError(/must be configured/);
  });

  it('rejects non-HTTP URLs, protocol-relative paths, and URLs with credentials or query values', () => {
    expect(() => resolveApiBaseUrl('api')).toThrowError(/root-relative path or an absolute HTTP\(S\) URL/);
    expect(() => resolveApiBaseUrl('//example.com/api')).toThrowError(/root-relative path or an absolute HTTP\(S\) URL/);
    expect(() => resolveApiBaseUrl('/api?token=secret')).toThrowError(/without query or hash/);
    expect(() => resolveApiBaseUrl('https://user:pass@example.com/api')).toThrowError(/without credentials/);
    expect(() => resolveApiBaseUrl('https://example.com/api?token=secret')).toThrowError(/without credentials/);
  });
});
