'use strict';

const express = require('express');
const db = require('../db');
const { isGestor } = require('../permissions');
const { logAction } = require('../audit');

const router = express.Router();

function serialize(s) {
  return { id: s.id, key: s.key, label: s.label, color: s.color, sortOrder: s.sort_order };
}

function slugify(label) {
  const base = String(label)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  let key = base || 'etapa';
  let suffix = 1;
  while (db.prepare('SELECT 1 FROM stages WHERE key = ?').get(key)) {
    key = `${base || 'etapa'}_${++suffix}`;
  }
  return key;
}

function requireGestorAction(req, res, next) {
  if (!isGestor(req.session.userId)) {
    return res.status(403).json({ error: 'Apenas o Gestor/Admin pode gerenciar as etapas da Jornada do Lead.' });
  }
  next();
}

router.get('/', (req, res) => {
  const stages = db.prepare('SELECT * FROM stages ORDER BY sort_order ASC').all().map(serialize);
  res.json({ stages });
});

router.post('/', requireGestorAction, (req, res) => {
  const { label, color } = req.body || {};
  if (!label || !label.trim()) return res.status(400).json({ error: 'Nome da etapa é obrigatório.' });
  const key = slugify(label);
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM stages').get().m;
  const result = db.prepare('INSERT INTO stages (key, label, color, sort_order) VALUES (?, ?, ?, ?)')
    .run(key, label.trim(), color || '#94A3B8', maxOrder + 1);
  logAction(req.session.userId, 'create', 'stage', result.lastInsertRowid, `Etapa criada: ${label}`);
  res.status(201).json({ stage: serialize(db.prepare('SELECT * FROM stages WHERE id = ?').get(result.lastInsertRowid)) });
});

router.put('/:id', requireGestorAction, (req, res) => {
  const stage = db.prepare('SELECT * FROM stages WHERE id = ?').get(req.params.id);
  if (!stage) return res.status(404).json({ error: 'Etapa não encontrada.' });
  const { label, color } = req.body || {};
  db.prepare('UPDATE stages SET label = COALESCE(?, label), color = COALESCE(?, color) WHERE id = ?')
    .run(label || null, color || null, req.params.id);
  logAction(req.session.userId, 'update', 'stage', req.params.id, `Etapa atualizada: ${stage.label}`);
  res.json({ stage: serialize(db.prepare('SELECT * FROM stages WHERE id = ?').get(req.params.id)) });
});

router.post('/:id/move', requireGestorAction, (req, res) => {
  const stage = db.prepare('SELECT * FROM stages WHERE id = ?').get(req.params.id);
  if (!stage) return res.status(404).json({ error: 'Etapa não encontrada.' });
  const { direction } = req.body || {};
  const all = db.prepare('SELECT * FROM stages ORDER BY sort_order ASC').all();
  const idx = all.findIndex(s => s.id === stage.id);
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= all.length) return res.status(400).json({ error: 'Não é possível mover além dos limites.' });

  const neighbor = all[targetIdx];
  db.prepare('UPDATE stages SET sort_order = ? WHERE id = ?').run(neighbor.sort_order, stage.id);
  db.prepare('UPDATE stages SET sort_order = ? WHERE id = ?').run(stage.sort_order, neighbor.id);
  res.json({ stages: db.prepare('SELECT * FROM stages ORDER BY sort_order ASC').all().map(serialize) });
});

router.delete('/:id', requireGestorAction, (req, res) => {
  const stage = db.prepare('SELECT * FROM stages WHERE id = ?').get(req.params.id);
  if (!stage) return res.status(404).json({ error: 'Etapa não encontrada.' });
  const inUse = db.prepare('SELECT COUNT(*) as c FROM leads WHERE stage = ?').get(stage.key).c;
  if (inUse > 0) {
    return res.status(400).json({ error: `Existem ${inUse} lead(s) nesta etapa. Mova-os para outra etapa antes de excluir.` });
  }
  db.prepare('DELETE FROM stages WHERE id = ?').run(req.params.id);
  logAction(req.session.userId, 'delete', 'stage', req.params.id, `Etapa excluída: ${stage.label}`);
  res.json({ ok: true });
});

module.exports = router;
