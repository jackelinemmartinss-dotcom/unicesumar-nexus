'use strict';

const express = require('express');
const db = require('../db');
const { requirePermission } = require('../permissions');
const { logAction } = require('../audit');
const { rescanLead } = require('./leads.routes');

const router = express.Router();

const INTEGRATION_LABELS = {
  instagram: 'Instagram',
  google: 'Google Ads / Google Forms',
  whatsapp: 'WhatsApp Business',
  site: 'Formulário do Site'
};

const SAMPLE_FIRST_NAMES = ['Mariana', 'Pedro', 'Isabela', 'Lucas', 'Fernanda', 'Bruno', 'Carolina', 'Diego', 'Sofia', 'Rodrigo', 'Aline', 'Felipe'];
const SAMPLE_LAST_NAMES = ['Ferreira', 'Souza', 'Carvalho', 'Ribeiro', 'Barbosa', 'Nogueira', 'Teixeira', 'Correia', 'Pinto', 'Moura'];
const SAMPLE_COURSES = ['Engenharia de Software', 'Medicina', 'Administração de Empresas', 'MBA em Inteligência Artificial & Data Science', 'Pedagogia'];
const SAMPLE_MESSAGES_PAGO = ['Vi o anúncio de vocês, quero saber mais sobre bolsas!', 'Qual o valor da primeira parcela?', 'Ainda dá tempo de me inscrever essa semana?'];
const SAMPLE_MESSAGES_ORGANICO = ['Uma amiga minha estuda aí, quero informações do curso.', 'Gostaria de saber a grade curricular completa.', 'Vocês têm aulas aos sábados?'];

function serialize(i) {
  return {
    id: i.id,
    key: i.key,
    label: INTEGRATION_LABELS[i.key] || i.key,
    status: i.status,
    connectedAt: i.connected_at,
    meta: i.meta ? JSON.parse(i.meta) : {}
  };
}

router.get('/', requirePermission('integracoes', 'view'), (req, res) => {
  const integrations = db.prepare('SELECT * FROM integrations ORDER BY id').all().map(serialize);
  res.json({ integrations });
});

router.post('/:key/connect', requirePermission('integracoes', 'edit'), (req, res) => {
  const integration = db.prepare('SELECT * FROM integrations WHERE key = ?').get(req.params.key);
  if (!integration) return res.status(404).json({ error: 'Integração não encontrada.' });
  db.prepare('UPDATE integrations SET status = ?, connected_at = ? WHERE key = ?').run('connected', new Date().toISOString(), req.params.key);
  logAction(req.session.userId, 'update', 'integration', req.params.key, `Integração conectada: ${req.params.key}`);
  res.json({ integration: serialize(db.prepare('SELECT * FROM integrations WHERE key = ?').get(req.params.key)) });
});

router.post('/:key/disconnect', requirePermission('integracoes', 'edit'), (req, res) => {
  const integration = db.prepare('SELECT * FROM integrations WHERE key = ?').get(req.params.key);
  if (!integration) return res.status(404).json({ error: 'Integração não encontrada.' });
  db.prepare('UPDATE integrations SET status = ?, connected_at = NULL WHERE key = ?').run('disconnected', req.params.key);
  logAction(req.session.userId, 'update', 'integration', req.params.key, `Integração desconectada: ${req.params.key}`);
  res.json({ integration: serialize(db.prepare('SELECT * FROM integrations WHERE key = ?').get(req.params.key)) });
});

// Simulates a lead arriving through a connected channel (no real webhook/OAuth available in this environment).
router.post('/:key/simulate-lead', requirePermission('integracoes', 'edit'), (req, res) => {
  const integration = db.prepare('SELECT * FROM integrations WHERE key = ?').get(req.params.key);
  if (!integration) return res.status(404).json({ error: 'Integração não encontrada.' });
  if (integration.status !== 'connected') {
    return res.status(400).json({ error: 'Conecte esta integração antes de simular a chegada de leads.' });
  }

  const sourceType = req.body && req.body.sourceType === 'pago' ? 'pago' : 'organico';
  const first = SAMPLE_FIRST_NAMES[Math.floor(Math.random() * SAMPLE_FIRST_NAMES.length)];
  const last = SAMPLE_LAST_NAMES[Math.floor(Math.random() * SAMPLE_LAST_NAMES.length)];
  const name = `${first} ${last}`;
  const course = SAMPLE_COURSES[Math.floor(Math.random() * SAMPLE_COURSES.length)];
  const messagePool = sourceType === 'pago' ? SAMPLE_MESSAGES_PAGO : SAMPLE_MESSAGES_ORGANICO;
  const message = messagePool[Math.floor(Math.random() * messagePool.length)];
  const now = new Date().toISOString();

  const firstStage = db.prepare('SELECT key FROM stages ORDER BY sort_order ASC LIMIT 1').get();
  const result = db.prepare(`
    INSERT INTO leads (name, email, phone, course_interest, polo, stage, temperature, temperature_locked, source_channel, source_type, owner_user_id, created_at, updated_at, last_interaction_at)
    VALUES (?, ?, ?, ?, 'Botucatu - SP', ?, 'morno', 0, ?, ?, NULL, ?, ?, ?)
  `).run(
    name,
    `${first.toLowerCase()}.${last.toLowerCase()}@exemplo.com`,
    `(14) 9${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`,
    course,
    firstStage ? firstStage.key : 'interessado',
    req.params.key,
    sourceType,
    now, now, now
  );
  const leadId = result.lastInsertRowid;

  db.prepare(`
    INSERT INTO lead_events (lead_id, type, channel, content, direction, author_user_id, created_at)
    VALUES (?, 'system', ?, ?, NULL, NULL, ?)
  `).run(leadId, req.params.key, `Lead capturado automaticamente via ${INTEGRATION_LABELS[req.params.key]} (${sourceType === 'pago' ? 'anúncio pago' : 'orgânico'}).`, now);

  db.prepare(`
    INSERT INTO lead_events (lead_id, type, channel, content, direction, author_user_id, created_at)
    VALUES (?, 'message', ?, ?, 'in', NULL, ?)
  `).run(leadId, req.params.key, message, now);

  const aiResult = rescanLead(leadId);
  logAction(req.session.userId, 'create', 'lead', leadId, `Lead simulado via ${req.params.key}`);

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
  res.status(201).json({
    lead: {
      id: lead.id, name: lead.name, courseInterest: lead.course_interest, stage: lead.stage,
      temperature: lead.temperature, sourceChannel: lead.source_channel, sourceType: lead.source_type
    },
    ai: aiResult
  });
});

module.exports = router;
