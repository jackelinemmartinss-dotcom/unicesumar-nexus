'use strict';

const express = require('express');
const db = require('../db');
const { requirePermission } = require('../permissions');
const { logAction } = require('../audit');

const router = express.Router();

const AUTOMATION_CHANNELS = ['whatsapp', 'email', 'sms', 'push'];

function serialize(a) {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    triggerDesc: a.trigger_desc,
    channel: a.channel,
    sendTime: a.send_time,
    message: a.message,
    active: !!a.active,
    runCount: a.run_count,
    lastRunAt: a.last_run_at
  };
}

router.get('/', requirePermission('automacoes', 'view'), (req, res) => {
  res.json({ automations: db.prepare('SELECT * FROM automations ORDER BY id').all().map(serialize) });
});

router.post('/', requirePermission('automacoes', 'create'), (req, res) => {
  const { name, description, triggerDesc, channel, sendTime, message } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });
  const chosenChannel = AUTOMATION_CHANNELS.includes(channel) ? channel : 'whatsapp';
  const result = db.prepare(`
    INSERT INTO automations (name, description, trigger_desc, channel, send_time, message, active, run_count, last_run_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 0, NULL)
  `).run(name.trim(), description || null, triggerDesc || null, chosenChannel, sendTime || '09:00', message || null);
  logAction(req.session.userId, 'create', 'automation', result.lastInsertRowid, `Automação criada: ${name}`);
  res.status(201).json({ automation: serialize(db.prepare('SELECT * FROM automations WHERE id = ?').get(result.lastInsertRowid)) });
});

router.put('/:id', requirePermission('automacoes', 'edit'), (req, res) => {
  const a = db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Automação não encontrada.' });
  const { name, description, triggerDesc, channel, sendTime, message } = req.body || {};
  db.prepare(`
    UPDATE automations SET
      name = COALESCE(?, name), description = ?, trigger_desc = ?,
      channel = ?, send_time = ?, message = ?
    WHERE id = ?
  `).run(
    name || null,
    description === undefined ? a.description : description,
    triggerDesc === undefined ? a.trigger_desc : triggerDesc,
    channel !== undefined ? (AUTOMATION_CHANNELS.includes(channel) ? channel : a.channel) : a.channel,
    sendTime === undefined ? a.send_time : sendTime,
    message === undefined ? a.message : message,
    req.params.id
  );
  logAction(req.session.userId, 'update', 'automation', req.params.id, `Automação atualizada: ${a.name}`);
  res.json({ automation: serialize(db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id)) });
});

router.patch('/:id/toggle', requirePermission('automacoes', 'edit'), (req, res) => {
  const a = db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Automação não encontrada.' });
  const nextActive = a.active ? 0 : 1;
  db.prepare('UPDATE automations SET active = ? WHERE id = ?').run(nextActive, req.params.id);
  logAction(req.session.userId, 'update', 'automation', req.params.id, `Automação ${nextActive ? 'ativada' : 'desativada'}: ${a.name}`);
  res.json({ automation: serialize(db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id)) });
});

router.post('/:id/run', requirePermission('automacoes', 'edit'), (req, res) => {
  const a = db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Automação não encontrada.' });
  if (!a.active) return res.status(400).json({ error: 'Ative a automação antes de executá-la.' });
  const now = new Date().toISOString();
  db.prepare('UPDATE automations SET run_count = run_count + 1, last_run_at = ? WHERE id = ?').run(now, req.params.id);
  logAction(req.session.userId, 'run', 'automation', req.params.id, `Execução manual (simulada) de: ${a.name}`);
  res.json({ automation: serialize(db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id)) });
});

// Sends a one-off test message to the requesting user, simulating the real
// dispatch channel/content without touching any lead data. No real message
// provider is wired up in this environment — see README limitations.
router.post('/:id/test-send', requirePermission('automacoes', 'edit'), (req, res) => {
  const a = db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Automação não encontrada.' });
  logAction(req.session.userId, 'test-send', 'automation', req.params.id, `Envio de teste simulado (${a.channel || 'whatsapp'}) para: ${a.name}`);
  res.json({
    ok: true,
    preview: {
      channel: a.channel || 'whatsapp',
      sendTime: a.send_time || '09:00',
      message: a.message || '(nenhuma mensagem configurada ainda)'
    }
  });
});

router.delete('/:id', requirePermission('automacoes', 'delete'), (req, res) => {
  const a = db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Automação não encontrada.' });
  db.prepare('DELETE FROM automations WHERE id = ?').run(req.params.id);
  logAction(req.session.userId, 'delete', 'automation', req.params.id, `Automação excluída: ${a.name}`);
  res.json({ ok: true });
});

module.exports = router;
