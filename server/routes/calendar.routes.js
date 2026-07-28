'use strict';

const express = require('express');
const db = require('../db');
const { requirePermission, isGestor } = require('../permissions');
const { logAction } = require('../audit');

const router = express.Router();

function getShares(eventId) {
  return db.prepare(`
    SELECT u.id, u.name FROM calendar_event_shares s
    JOIN users u ON u.id = s.user_id WHERE s.event_id = ?
  `).all(eventId);
}

function setShares(eventId, userIds) {
  db.prepare('DELETE FROM calendar_event_shares WHERE event_id = ?').run(eventId);
  const insert = db.prepare('INSERT OR IGNORE INTO calendar_event_shares (event_id, user_id) VALUES (?, ?)');
  (Array.isArray(userIds) ? userIds : []).forEach(uid => insert.run(eventId, uid));
}

function serializeEvent(e, currentUserId) {
  const owner = db.prepare('SELECT name FROM users WHERE id = ?').get(e.owner_user_id);
  return {
    id: e.id,
    ownerUserId: e.owner_user_id,
    ownerName: owner ? owner.name : null,
    title: e.title,
    type: e.type,
    startsAt: e.starts_at,
    isPrivate: !!e.is_private,
    sharedWith: getShares(e.id),
    isOwner: e.owner_user_id === currentUserId
  };
}

// GET /api/calendar?ownerUserId=all|<id>
router.get('/', requirePermission('calendario', 'view'), (req, res) => {
  const gestor = isGestor(req.session.userId);
  let rows;

  if (!gestor) {
    rows = db.prepare(`
      SELECT DISTINCT e.* FROM calendar_events e
      LEFT JOIN calendar_event_shares s ON s.event_id = e.id
      WHERE e.owner_user_id = ? OR s.user_id = ?
      ORDER BY e.starts_at ASC
    `).all(req.session.userId, req.session.userId);
  } else {
    const filter = req.query.ownerUserId;
    if (!filter || filter === 'all') {
      rows = db.prepare('SELECT * FROM calendar_events ORDER BY starts_at ASC').all();
    } else {
      rows = db.prepare('SELECT * FROM calendar_events WHERE owner_user_id = ? ORDER BY starts_at ASC').all(filter);
    }
  }

  res.json({ events: rows.map(e => serializeEvent(e, req.session.userId)), isGestor: gestor });
});

router.post('/', requirePermission('calendario', 'create'), (req, res) => {
  const { title, type, startsAt, isPrivate, ownerUserId, sharedWithUserIds } = req.body || {};
  if (!title || !startsAt) return res.status(400).json({ error: 'Título e data/hora são obrigatórios.' });

  const gestor = isGestor(req.session.userId);
  const owner = gestor && ownerUserId ? ownerUserId : req.session.userId;

  const result = db.prepare(`
    INSERT INTO calendar_events (owner_user_id, title, type, starts_at, is_private)
    VALUES (?, ?, ?, ?, ?)
  `).run(owner, title.trim(), type || 'Geral', startsAt, isPrivate === false ? 0 : 1);

  setShares(result.lastInsertRowid, sharedWithUserIds);

  logAction(req.session.userId, 'create', 'calendar_event', result.lastInsertRowid, `Evento criado: ${title}`);
  const created = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ event: serializeEvent(created, req.session.userId) });
});

router.put('/:id', requirePermission('calendario', 'edit'), (req, res) => {
  const evt = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(req.params.id);
  if (!evt) return res.status(404).json({ error: 'Evento não encontrado.' });
  const gestor = isGestor(req.session.userId);
  if (!gestor && evt.owner_user_id !== req.session.userId) {
    return res.status(403).json({ error: 'Você só pode editar seus próprios eventos.' });
  }

  const { title, type, startsAt, isPrivate, sharedWithUserIds } = req.body || {};
  db.prepare(`
    UPDATE calendar_events SET
      title = COALESCE(?, title),
      type = COALESCE(?, type),
      starts_at = COALESCE(?, starts_at),
      is_private = COALESCE(?, is_private)
    WHERE id = ?
  `).run(title || null, type || null, startsAt || null, isPrivate === undefined ? null : (isPrivate ? 1 : 0), req.params.id);

  if (sharedWithUserIds !== undefined) setShares(req.params.id, sharedWithUserIds);

  logAction(req.session.userId, 'update', 'calendar_event', req.params.id, `Evento atualizado: ${evt.title}`);
  const updated = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(req.params.id);
  res.json({ event: serializeEvent(updated, req.session.userId) });
});

router.delete('/:id', requirePermission('calendario', 'delete'), (req, res) => {
  const evt = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(req.params.id);
  if (!evt) return res.status(404).json({ error: 'Evento não encontrado.' });
  const gestor = isGestor(req.session.userId);
  if (!gestor && evt.owner_user_id !== req.session.userId) {
    return res.status(403).json({ error: 'Você só pode excluir seus próprios eventos.' });
  }
  db.prepare('DELETE FROM calendar_events WHERE id = ?').run(req.params.id);
  logAction(req.session.userId, 'delete', 'calendar_event', req.params.id, `Evento excluído: ${evt.title}`);
  res.json({ ok: true });
});

// List of active users, used both for the Gestor's calendar filter dropdown
// and for the "Compartilhar" picker available to any user creating an event.
router.get('/team-members', requirePermission('calendario', 'view'), (req, res) => {
  const members = db.prepare('SELECT id, name FROM users WHERE active = 1 AND id != ? ORDER BY name').all(req.session.userId);
  res.json({ members });
});

module.exports = router;
