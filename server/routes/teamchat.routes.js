'use strict';

const express = require('express');
const db = require('../db');
const { requirePermission, isGestor } = require('../permissions');
const { logAction } = require('../audit');

const router = express.Router();

function isMember(groupId, userId) {
  return !!db.prepare('SELECT 1 FROM chat_group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId);
}

function serializeGroup(g, currentUserId) {
  const members = db.prepare(`
    SELECT u.id, u.name, u.avatar_initials FROM chat_group_members m
    JOIN users u ON u.id = m.user_id WHERE m.group_id = ?
  `).all(g.id);
  const lastMsg = db.prepare('SELECT content, created_at FROM chat_group_messages WHERE group_id = ? ORDER BY created_at DESC LIMIT 1').get(g.id);
  return {
    id: g.id,
    name: g.name,
    createdAt: g.created_at,
    members,
    isMember: isMember(g.id, currentUserId),
    lastMessage: lastMsg ? lastMsg.content : null,
    lastMessageAt: lastMsg ? lastMsg.created_at : null
  };
}

// Gestor sees every group (so they can manage them); everyone else only sees groups they belong to.
router.get('/groups', requirePermission('comunicacoes', 'view'), (req, res) => {
  const gestor = isGestor(req.session.userId);
  const rows = gestor
    ? db.prepare('SELECT * FROM chat_groups ORDER BY created_at DESC').all()
    : db.prepare(`
        SELECT g.* FROM chat_groups g
        JOIN chat_group_members m ON m.group_id = g.id
        WHERE m.user_id = ? ORDER BY g.created_at DESC
      `).all(req.session.userId);
  res.json({ groups: rows.map(g => serializeGroup(g, req.session.userId)) });
});

router.post('/groups', requirePermission('comunicacoes', 'view'), (req, res) => {
  if (!isGestor(req.session.userId)) return res.status(403).json({ error: 'Apenas o Gestor/Admin pode criar grupos.' });
  const { name, memberUserIds } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nome do grupo é obrigatório.' });

  const now = new Date().toISOString();
  const groupId = db.prepare('INSERT INTO chat_groups (name, created_by_user_id, created_at) VALUES (?, ?, ?)')
    .run(name.trim(), req.session.userId, now).lastInsertRowid;

  const insertMember = db.prepare('INSERT OR IGNORE INTO chat_group_members (group_id, user_id) VALUES (?, ?)');
  insertMember.run(groupId, req.session.userId);
  (Array.isArray(memberUserIds) ? memberUserIds : []).forEach(uid => insertMember.run(groupId, uid));

  logAction(req.session.userId, 'create', 'chat_group', groupId, `Grupo criado: ${name}`);
  const group = db.prepare('SELECT * FROM chat_groups WHERE id = ?').get(groupId);
  res.status(201).json({ group: serializeGroup(group, req.session.userId) });
});

router.delete('/groups/:id', requirePermission('comunicacoes', 'view'), (req, res) => {
  if (!isGestor(req.session.userId)) return res.status(403).json({ error: 'Apenas o Gestor/Admin pode excluir grupos.' });
  const group = db.prepare('SELECT * FROM chat_groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Grupo não encontrado.' });
  db.prepare('DELETE FROM chat_groups WHERE id = ?').run(req.params.id);
  logAction(req.session.userId, 'delete', 'chat_group', req.params.id, `Grupo excluído: ${group.name}`);
  res.json({ ok: true });
});

router.post('/groups/:id/members', requirePermission('comunicacoes', 'view'), (req, res) => {
  if (!isGestor(req.session.userId)) return res.status(403).json({ error: 'Apenas o Gestor/Admin pode adicionar membros.' });
  const group = db.prepare('SELECT * FROM chat_groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Grupo não encontrado.' });
  const { userId } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(400).json({ error: 'Usuário inválido.' });
  db.prepare('INSERT OR IGNORE INTO chat_group_members (group_id, user_id) VALUES (?, ?)').run(req.params.id, userId);
  logAction(req.session.userId, 'update', 'chat_group', req.params.id, `${user.name} adicionado ao grupo ${group.name}`);
  res.json({ group: serializeGroup(group, req.session.userId) });
});

router.delete('/groups/:id/members/:userId', requirePermission('comunicacoes', 'view'), (req, res) => {
  if (!isGestor(req.session.userId)) return res.status(403).json({ error: 'Apenas o Gestor/Admin pode remover membros.' });
  const group = db.prepare('SELECT * FROM chat_groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Grupo não encontrado.' });
  db.prepare('DELETE FROM chat_group_members WHERE group_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
  logAction(req.session.userId, 'update', 'chat_group', req.params.id, `Membro removido do grupo ${group.name}`);
  res.json({ group: serializeGroup(group, req.session.userId) });
});

router.get('/groups/:id/messages', requirePermission('comunicacoes', 'view'), (req, res) => {
  const group = db.prepare('SELECT * FROM chat_groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Grupo não encontrado.' });
  if (!isGestor(req.session.userId) && !isMember(req.params.id, req.session.userId)) {
    return res.status(403).json({ error: 'Você não participa deste grupo.' });
  }
  const messages = db.prepare(`
    SELECT m.*, u.name as author_name, u.avatar_initials as author_initials
    FROM chat_group_messages m LEFT JOIN users u ON u.id = m.author_user_id
    WHERE m.group_id = ? ORDER BY m.created_at ASC
  `).all(req.params.id);
  res.json({ messages: messages.map(m => ({ id: m.id, content: m.content, createdAt: m.created_at, authorId: m.author_user_id, authorName: m.author_name, authorInitials: m.author_initials })) });
});

router.post('/groups/:id/messages', requirePermission('comunicacoes', 'create'), (req, res) => {
  const group = db.prepare('SELECT * FROM chat_groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Grupo não encontrado.' });
  if (!isGestor(req.session.userId) && !isMember(req.params.id, req.session.userId)) {
    return res.status(403).json({ error: 'Você não participa deste grupo.' });
  }
  const { content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'Mensagem vazia.' });
  const now = new Date().toISOString();
  db.prepare('INSERT INTO chat_group_messages (group_id, author_user_id, content, created_at) VALUES (?, ?, ?, ?)')
    .run(req.params.id, req.session.userId, content.trim(), now);
  res.status(201).json({ ok: true });
});

module.exports = router;
