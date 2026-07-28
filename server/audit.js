'use strict';

const db = require('./db');

const insertStmt = db.prepare(`
  INSERT INTO audit_log (user_id, action, entity, entity_id, details, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

function logAction(userId, action, entity, entityId, details) {
  insertStmt.run(userId || null, action, entity || null, entityId != null ? String(entityId) : null, details || null, new Date().toISOString());
}

module.exports = { logAction };
