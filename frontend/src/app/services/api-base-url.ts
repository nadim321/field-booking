export function resolveApiBaseUrl(hostname: string, configuredUrl?: string): string {
  if (hostname === 'localhost') return 'http://localhost:5000/api';
  const configured = configuredUrl?.trim().replace(/\/+$/, '');
  return configured || '/api';
}
