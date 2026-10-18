import { resolveApiBaseUrl } from './api-base-url';

describe('resolveApiBaseUrl', () => {
  it('uses the local backend during local development', () => {
    expect(resolveApiBaseUrl('localhost', 'https://api.example.com/api')).toBe('http://localhost:5000/api');
  });

  it('uses the configured remote backend in production', () => {
    expect(resolveApiBaseUrl('field-booking-front.onrender.com', 'https://field-booking-back.onrender.com/api/'))
      .toBe('https://field-booking-back.onrender.com/api');
  });

  it('falls back to same-origin API when no backend URL is configured', () => {
    expect(resolveApiBaseUrl('booking.example.com')).toBe('/api');
  });
});
