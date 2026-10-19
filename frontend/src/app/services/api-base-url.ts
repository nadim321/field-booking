export function resolveApiBaseUrl(hostname: string, configuredUrl?: string): string {
  if (hostname === 'localhost') return 'http://localhost:5000/api';
  if (hostname === '127.0.0.1' || hostname.endsWith('.localhost')) return '/api';
  const configured = configuredUrl?.trim().replace(/\/+$/, '');
  return configured || 'https://field-booking-back.onrender.com/api';
}
