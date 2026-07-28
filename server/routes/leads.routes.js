'use strict';

const express = require('express');
const db = require('../db');
const { requirePermission } = require('../permissions');
const { TEMPERATURE_KEYS, CHANNEL_KEYS, TEMPERATURES, CHANNELS } = require('../constants');
const leadScoring = require('../ai/leadScoring');
const { logAction } = require('../audit');

const router = express.Router();

function getEvents(leadId) {
  return db.prepare('SELECT * FROM lead_events WHERE lead_id = ? ORDER BY created_at ASC').all(leadId);
}

function isValidStage(key) {
  return !!db.prepare('SELECT 1 FROM stages WHERE key = ?').get(key);
}

function defaultStageKey() {
  const first = db.prepare('SELECT key FROM stages ORDER BY sort_order ASC LIMIT 1').get();
  return first ? first.key : 'interessado';
}

function ownerName(ownerId) {
  if (!ownerId) return null;
  const u = db.prepare('SELECT name FROM users WHERE id = ?').get(ownerId);
  return u ? u.name : null;
}

function serializeLead(lead, includeAi) {
  const base = {
    id: lead.id,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    courseInterest: lead.course_interest,
    polo: lead.polo,
    stage: lead.stage,
    temperature: lead.temperature,
    temperatureLocked: !!lead.temperature_locked,
    sourceChannel: lead.source_channel,
    sourceType: lead.source_type,
    ownerUserId: lead.owner_user_id,
    ownerName: ownerName(lead.owner_user_id),
    createdAt: lead.created_at,
    updatedAt: lead.updated_at,
    lastInteractionAt: lead.last_interaction_at
  };
  if (includeAi) {
    const events = getEvents(lead.id);
    base.events = events;
    base.ai = leadScoring.classify(lead, events);
  }
  return base;
}

router.get('/', requirePermission('pipelines', 'view'), (req, res) => {
  const leads = db.prepare('SELECT * FROM leads ORDER BY updated_at DESC').all().map(l => serializeLead(l, false));
  res.json({ leads });
});

// Predefined "broadcast lists" (WhatsApp-style) built from live segment counts.
// Registered before "/:id" so these fixed paths are never swallowed by the id param route.
router.get('/broadcast-lists', requirePermission('segmentos', 'view'), (req, res) => {
  const lists = [];
  for (const t of TEMPERATURES) {
    lists.push({
      id: `temperature:${t.key}`, filterType: 'temperature', filterValue: t.key,
      label: `Leads ${t.label}`, icon: 'thermometer', color: t.color,
      count: db.prepare('SELECT COUNT(*) as c FROM leads WHERE temperature = ?').get(t.key).c
    });
  }
  for (const c of CHANNELS) {
    lists.push({
      id: `sourceChannel:${c.key}`, filterType: 'sourceChannel', filterValue: c.key,
      label: `Via ${c.label}`, icon: 'radio', color: '#00A3E0',
      count: db.prepare('SELECT COUNT(*) as c FROM leads WHERE source_channel = ?').get(c.key).c
    });
  }
  lists.push({
    id: 'sourceType:pago', filterType: 'sourceType', filterValue: 'pago',
    label: 'Vindos de Anúncio Pago', icon: 'trending-up', color: '#8B5CF6',
    count: db.prepare("SELECT COUNT(*) as c FROM leads WHERE source_type = 'pago'").get().c
  });
  lists.push({
    id: 'sourceType:organico', filterType: 'sourceType', filterValue: 'organico',
    label: 'Vindos de Busca Orgânica', icon: 'compass', color: '#10B981',
    count: db.prepare("SELECT COUNT(*) as c FROM leads WHERE source_type = 'organico'").get().c
  });
  res.json({ lists: lists.filter(l => l.count > 0) });
});

router.get('/broadcasts', requirePermission('segmentos', 'view'), (req, res) => {
  const { filterType, filterValue } = req.query;
  let rows;
  if (filterType && filterValue) {
    rows = db.prepare('SELECT * FROM broadcasts WHERE filter_type = ? AND filter_value = ? ORDER BY created_at DESC').all(filterType, filterValue);
  } else {
    rows = db.prepare('SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT 50').all();
  }
  const broadcasts = rows.map(b => {
    const author = b.sent_by_user_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(b.sent_by_user_id) : null;
    return {
      id: b.id, filterType: b.filter_type, filterValue: b.filter_value, message: b.message,
      authorName: author ? author.name : 'Sistema', reachedCount: b.reached_count, createdAt: b.created_at
    };
  });
  res.json({ broadcasts });
});

router.get('/:id', requirePermission('pipelines', 'view'), (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });
  res.json({ lead: serializeLead(lead, true) });
});

router.post('/', requirePermission('pipelines', 'create'), (req, res) => {
  const { name, email, phone, courseInterest, polo, sourceChannel, sourceType, ownerUserId } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nome do lead é obrigatório.' });
  const channel = CHANNEL_KEYS.includes(sourceChannel) ? sourceChannel : 'site';
  const type = sourceType === 'pago' ? 'pago' : 'organico';
  const now = new Date().toISOString();

  const result = db.prepare(`
    INSERT INTO leads (name, email, phone, course_interest, polo, stage, temperature, temperature_locked, source_channel, source_type, owner_user_id, created_at, updated_at, last_interaction_at)
    VALUES (?, ?, ?, ?, ?, ?, 'morno', 0, ?, ?, ?, ?, ?, ?)
  `).run(name.trim(), email || null, phone || null, courseInterest || null, polo || null, defaultStageKey(), channel, type, ownerUserId || req.session.userId, now, now, now);

  const leadId = result.lastInsertRowid;
  db.prepare(`
    INSERT INTO lead_events (lead_id, type, channel, content, direction, author_user_id, created_at)
    VALUES (?, 'system', ?, ?, NULL, ?, ?)
  `).run(leadId, channel, `Lead cadastrado manualmente via ${channel}.`, req.session.userId, now);

  rescanLead(leadId);
  logAction(req.session.userId, 'create', 'lead', leadId, `Lead criado: ${name}`);
  const created = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
  res.status(201).json({ lead: serializeLead(created, true) });
});

router.put('/:id', requirePermission('pipelines', 'edit'), (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });
  const { name, email, phone, courseInterest, polo, ownerUserId } = req.body || {};

  db.prepare(`
    UPDATE leads SET
      name = COALESCE(?, name),
      email = ?,
      phone = ?,
      course_interest = ?,
      polo = ?,
      owner_user_id = COALESCE(?, owner_user_id),
      updated_at = ?
    WHERE id = ?
  `).run(
    name || null,
    email === undefined ? lead.email : email,
    phone === undefined ? lead.phone : phone,
    courseInterest === undefined ? lead.course_interest : courseInterest,
    polo === undefined ? lead.polo : polo,
    ownerUserId || null,
    new Date().toISOString(),
    req.params.id
  );

  logAction(req.session.userId, 'update', 'lead', req.params.id, `Lead atualizado: ${lead.name}`);
  const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  res.json({ lead: serializeLead(updated, true) });
});

router.delete('/:id', requirePermission('pipelines', 'delete'), (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });
  db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  logAction(req.session.userId, 'delete', 'lead', req.params.id, `Lead excluído: ${lead.name}`);
  res.json({ ok: true });
});

// Drag-and-drop: move between journey stages or temperature lanes.
router.patch('/:id/move', requirePermission('pipelines', 'edit'), (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });
  const { stage, temperature } = req.body || {};

  const updates = [];
  const values = [];

  if (stage !== undefined) {
    if (!isValidStage(stage)) return res.status(400).json({ error: 'Etapa inválida.' });
    updates.push('stage = ?');
    values.push(stage);
  }
  if (temperature !== undefined) {
    if (!TEMPERATURE_KEYS.includes(temperature)) return res.status(400).json({ error: 'Temperatura inválida.' });
    updates.push('temperature = ?', 'temperature_locked = 1');
    values.push(temperature);
  }
  if (!updates.length) return res.status(400).json({ error: 'Nada para atualizar.' });

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(req.params.id);

  db.prepare(`UPDATE leads SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const detail = stage !== undefined ? `moveu para a etapa "${stage}"` : `reclassificou manualmente como "${temperature}"`;
  db.prepare(`
    INSERT INTO lead_events (lead_id, type, channel, content, direction, author_user_id, created_at)
    VALUES (?, 'stage_change', NULL, ?, NULL, ?, ?)
  `).run(req.params.id, `Movido: ${detail}`, req.session.userId, new Date().toISOString());

  logAction(req.session.userId, 'update', 'lead', req.params.id, `Lead ${detail}`);
  const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  res.json({ lead: serializeLead(updated, true) });
});

function rescanLead(leadId) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
  const events = getEvents(leadId);
  const result = leadScoring.classify(lead, events);
  db.prepare('UPDATE leads SET temperature = ?, temperature_locked = 0 WHERE id = ?').run(result.temperature, leadId);
  return result;
}

router.post('/:id/rescan', requirePermission('pipelines', 'edit'), (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });
  rescanLead(req.params.id);
  logAction(req.session.userId, 'update', 'lead', req.params.id, 'Reclassificação por IA solicitada');
  const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  res.json({ lead: serializeLead(updated, true) });
});

router.post('/:id/messages', requirePermission('comunicacoes', 'create'), (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });
  const { content, direction, channel } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'Mensagem vazia.' });
  const dir = direction === 'in' ? 'in' : 'out';
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO lead_events (lead_id, type, channel, content, direction, author_user_id, created_at)
    VALUES (?, 'message', ?, ?, ?, ?, ?)
  `).run(req.params.id, channel || lead.source_channel, content.trim(), dir, req.session.userId, now);

  db.prepare('UPDATE leads SET last_interaction_at = ?, updated_at = ? WHERE id = ?').run(now, now, req.params.id);
  if (!lead.temperature_locked) rescanLead(req.params.id);

  const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  res.status(201).json({ lead: serializeLead(updated, true) });
});

router.post('/:id/notes', requirePermission('pipelines', 'edit'), (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });
  const { content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'Nota vazia.' });
  db.prepare(`
    INSERT INTO lead_events (lead_id, type, channel, content, direction, author_user_id, created_at)
    VALUES (?, 'note', NULL, ?, NULL, ?, ?)
  `).run(req.params.id, content.trim(), req.session.userId, new Date().toISOString());
  const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  res.status(201).json({ lead: serializeLead(updated, true) });
});

// Bulk broadcast: sends the same outbound message to every lead matching a segment filter.
router.post('/broadcast', requirePermission('segmentos', 'create'), (req, res) => {
  const { filterType, filterValue, message } = req.body || {};
  if (!message || !message.trim()) return res.status(400).json({ error: 'Mensagem vazia.' });
  if (!['temperature', 'sourceChannel', 'sourceType'].includes(filterType)) {
    return res.status(400).json({ error: 'Filtro de segmento inválido.' });
  }

  const columnMap = { temperature: 'temperature', sourceChannel: 'source_channel', sourceType: 'source_type' };
  const leads = db.prepare(`SELECT * FROM leads WHERE ${columnMap[filterType]} = ?`).all(filterValue);
  const now = new Date().toISOString();

  const insertEvt = db.prepare(`
    INSERT INTO lead_events (lead_id, type, channel, content, direction, author_user_id, created_at)
    VALUES (?, 'message', ?, ?, 'out', ?, ?)
  `);

  for (const lead of leads) {
    insertEvt.run(lead.id, lead.source_channel, message.trim(), req.session.userId, now);
    db.prepare('UPDATE leads SET updated_at = ? WHERE id = ?').run(now, lead.id);
  }

  db.prepare(`
    INSERT INTO broadcasts (filter_type, filter_value, message, sent_by_user_id, reached_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(filterType, filterValue, message.trim(), req.session.userId, leads.length, now);

  logAction(req.session.userId, 'broadcast', 'lead', null, `Transmissão enviada para ${leads.length} lead(s) (${filterType}=${filterValue})`);
  res.json({ ok: true, reached: leads.length });
});

// Bulk import of contacts/leads (from a spreadsheet exported with the same columns as /reports/leads.csv).
router.post('/import', requirePermission('pipelines', 'create'), (req, res) => {
  const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
  let created = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const row of rows) {
    const name = (row.name || '').toString().trim();
    if (!name) { skipped++; continue; }
    const stage = isValidStage(row.stage) ? row.stage : defaultStageKey();
    const channel = CHANNEL_KEYS.includes(row.sourceChannel) ? row.sourceChannel : 'site';
    const sourceType = row.sourceType === 'pago' ? 'pago' : 'organico';

    const result = db.prepare(`
      INSERT INTO leads (name, email, phone, course_interest, polo, stage, temperature, temperature_locked, source_channel, source_type, owner_user_id, created_at, updated_at, last_interaction_at)
      VALUES (?, ?, ?, ?, ?, ?, 'morno', 0, ?, ?, ?, ?, ?, ?)
    `).run(name, row.email || null, row.phone || null, row.courseInterest || null, row.polo || null, stage, channel, sourceType, req.session.userId, now, now, now);

    const leadId = result.lastInsertRowid;
    db.prepare(`
      INSERT INTO lead_events (lead_id, type, channel, content, direction, author_user_id, created_at)
      VALUES (?, 'system', ?, 'Lead importado via planilha de contatos.', NULL, ?, ?)
    `).run(leadId, channel, req.session.userId, now);

    rescanLead(leadId);
    created++;
  }

  logAction(req.session.userId, 'import', 'lead', null, `Importação de contatos: ${created} criado(s), ${skipped} ignorado(s)`);
  res.json({ created, skipped });
});

module.exports = { router, rescanLead, serializeLead };
