// Compatibility entry point for tools that used the original migration.
module.exports = pool => require('./runner').run(pool);
