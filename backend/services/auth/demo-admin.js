const DEMO_ADMIN_USERNAME = 'admin';
const DEMO_ADMIN_PASSWORD = 'admin123';

function demoAdminLoginEnabled() {
  return process.env.DEMO_ADMIN_LOGIN_ENABLED === 'true';
}

module.exports = { DEMO_ADMIN_USERNAME, DEMO_ADMIN_PASSWORD, demoAdminLoginEnabled };
