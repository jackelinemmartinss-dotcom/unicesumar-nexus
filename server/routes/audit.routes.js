'use strict';

const express = require('express');
const db = require('../db');
const { requireGestor } = require('../permissions');

const router = express.Router();

router.get('/', requireGestor, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const logs = db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?').all(limit).map(l => {
    const user = l.user_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(l.user_id) : null;
    return {
      id: l.id,
      userName: user ? user.name : 'Sistema',
      action: l.action,
      entity: l.entity,
      entityId: l.entity_id,
      details: l.details,
      createdAt: l.created_at
    };
  });
  res.json({ logs });
});

module.exports = router;
