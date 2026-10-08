const base = process.env.MONITOR_BASE_URL || 'http://127.0.0.1:5000';
(async () => {
  try {
    const response = await fetch(`${base}/health/ready`, { signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    if (!response.ok || body.status !== 'ready') throw new Error('unhealthy');
    console.log(JSON.stringify({ event: 'health_check', status: 'ready', time: new Date().toISOString() }));
  } catch {
    console.error(JSON.stringify({ event: 'health_check', status: 'unhealthy', time: new Date().toISOString() }));
    process.exitCode = 1;
  }
})();
