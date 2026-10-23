export function resolveApiBaseUrl(configuredUrl: string): string {
  const configured = configuredUrl.trim().replace(/\/+$/, '');
  if (!configured) throw new Error('apiBaseUrl must be configured in the Angular environment.');

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('apiBaseUrl must be an absolute HTTP(S) URL.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('apiBaseUrl must be an absolute HTTP(S) URL without credentials, query, or hash.');
  }

  return configured;
}
