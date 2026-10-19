import { resolveApiBaseUrl } from './api-base-url';

describe('resolveApiBaseUrl', () => {
  it('uses the local backend during local development', () => {
    expect(resolveApiBaseUrl('localhost', 'https://api.example.com/api')).toBe('http://localhost:5000/api');
  });

  it('uses the configured remote backend in production', () => {
    expect(resolveApiBaseUrl('field-booking-front.onrender.com', 'https://field-booking-back.onrender.com/api/'))
      .toBe('https://field-booking-back.onrender.com/api');
  });

  it('uses the deployed backend when production config is missing or blank', () => {
    const deployedBackend = 'https://field-booking-back.onrender.com/api';
    expect(resolveApiBaseUrl('booking.example.com')).toBe(deployedBackend);
    expect(resolveApiBaseUrl('booking.example.com', '  ')).toBe(deployedBackend);
  });

  it('keeps loopback test hosts on same-origin API routing', () => {
    expect(resolveApiBaseUrl('127.0.0.1')).toBe('/api');
  });
});
