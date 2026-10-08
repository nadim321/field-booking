// Emit JSON to stdout/stderr for the host log collector. Never serialize request
// bodies, query strings, headers, gateway payloads or raw database errors.
function write(level, event, fields = {}) {
  const record = { time: new Date().toISOString(), level, event, ...fields };
  (level === 'error' ? console.error : console.log)(JSON.stringify(record));
}
module.exports = {
  info: (event, fields) => write('info', event, fields),
  error: (event, fields) => write('error', event, fields)
};
