function serializeRuntimeConfig({ sentryDsn = '', release = 'development', environment = 'development' } = {}) {
  const json = JSON.stringify({ sentryDsn, release, environment })
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  return `window.__BOOKING_RUNTIME_CONFIG__ = Object.freeze(${json});`;
}

module.exports = { serializeRuntimeConfig };
