'use strict';

// Public (unauthenticated) webhook receiver — the URL itself embeds a random
// per-integration token, which acts as the shared secret. This lets an
// external tool (Zapier, Make, a real Instagram/WhatsApp webhook relay, or a
// plain curl/Postman request) actually create a lead in Nexus, unlike the
// "Simular Lead" buttons in the UI which just fabricate sample data.

const express = require('express');
const db = require('../db');
const leadScoring = require('../ai/leadScoring');

const router = express.Router();

function getMeta(integration) {
  try { return integration.meta ? JSON.parse(integration.meta) : {}; } catch { return {}; }
}

router.post('/:key/:token', (req, res) => {
  const integration = db.prepare('SELECT * FROM integrations WHERE key = ?').get(req.params.key);
  if (!integration) return res.status(404).json({ error: 'Integração não encontrada.' });
  if (integration.status !== 'connected') return res.status(400).json({ error: 'Integração desconectada.' });

  const meta = getMeta(integration);
  if (!meta.webhookToken || meta.webhookToken !== req.params.token) {
    return res.status(403).json({ error: 'Token de webhook inválido.' });
  }

  const { name, email, phone, courseInterest, polo, sourceType, message } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Campo "name" é obrigatório.' });

  const firstStage = db.prepare('SELECT key FROM stages ORDER BY sort_order ASC LIMIT 1').get();
  const now = new Date().toISOString();
  const type = sourceType === 'pago' ? 'pago' : 'organico';

  const result = db.prepare(`
    INSERT INTO leads (name, email, phone, course_interest, polo, stage, temperature, temperature_locked, source_channel, source_type, owner_user_id, created_at, updated_at, last_interaction_at)
    VALUES (?, ?, ?, ?, ?, ?, 'morno', 0, ?, ?, NULL, ?, ?, ?)
  `).run(
    String(name).trim(), email || null, phone || null, courseInterest || null, polo || null,
    firstStage ? firstStage.key : 'interessado', req.params.key, type, now, now, now
  );
  const leadId = result.lastInsertRowid;

  db.prepare(`
    INSERT INTO lead_events (lead_id, type, channel, content, direction, author_user_id, created_at)
    VALUES (?, 'system', ?, ?, NULL, NULL, ?)
  `).run(leadId, req.params.key, `Lead recebido via webhook externo (${req.params.key}).`, now);

  if (message && String(message).trim()) {
    db.prepare(`
      INSERT INTO lead_events (lead_id, type, channel, content, direction, author_user_id, created_at)
      VALUES (?, 'message', ?, ?, 'in', NULL, ?)
    `).run(leadId, req.params.key, String(message).trim(), now);
  }

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
  const events = db.prepare('SELECT * FROM lead_events WHERE lead_id = ? ORDER BY created_at ASC').all(leadId);
  const ai = leadScoring.classify(lead, events);
  db.prepare('UPDATE leads SET temperature = ? WHERE id = ?').run(ai.temperature, leadId);

  res.status(201).json({ ok: true, leadId, temperature: ai.temperature });
});

module.exports = router;
