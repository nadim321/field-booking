const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const wrap = require('../middleware/async-handler');
const media = require('../services/media.service');
const venue = require('../services/venue.service');
router.post('/api/admin/media', auth, express.raw({ type: ['image/jpeg','image/png','image/webp','application/octet-stream'], limit: '5mb', inflate: false }), wrap(async (req,res) => {
  res.status(201).json(await media.upload(req.body, req.query.kind));
}));
router.delete('/api/admin/media/:id', auth, wrap(async (req,res) => { await media.remove(req.params.id); res.json({ message: 'Media removed' }); }));
router.get('/api/media/:id', wrap(async (req,res,next) => {
  const row = await venue.transaction(async c => (await c.query('SELECT filename FROM venue_media WHERE id=?', [req.params.id]))[0][0]);
  if (!row) return res.status(404).json({ message: 'Image not found' });
  res.set('X-Content-Type-Options','nosniff');
  res.sendFile(media.filePath(row.filename), { maxAge: '1d' }, error => {
    if (error && !res.headersSent) { if (error.code === 'ENOENT') res.status(404).json({ message: 'Image not found' }); else next(error); }
  });
}));
module.exports = router;
