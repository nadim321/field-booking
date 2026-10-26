const db = require('../database');

module.exports = (req, res, next) => {
  res.once('finish', () => {
    const actor = req.user;
    if (!actor || !req.path.startsWith('/api/admin/') || ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || res.statusCode >= 400) return;
    const resource = (req.route?.path || req.path).slice(0, 255);
    const candidateId = res.locals?.auditResourceId ?? Object.values(req.params || {})[0];
    const resourceId = typeof candidateId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(candidateId) ? candidateId : null;
    db.run(`INSERT INTO admin_audit_log (actor_id,actor_name,action,resource,resource_id,http_method,response_status)
      VALUES (?,?,?,?,?,?,?)`, [Number(actor.id) || null, String(actor.username || `Admin #${actor.id}`).slice(0, 255), req.method.toLowerCase(), resource, resourceId, req.method, res.statusCode], () => {});
  });
  next();
};
