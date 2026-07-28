'use strict';

const express = require('express');
const db = require('../db');
const { requirePermission, isGestor } = require('../permissions');
const { logAction } = require('../audit');

const router = express.Router();

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n;]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function toCsv(headers, rows) {
  const lines = [headers.join(';')];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(';'));
  }
  return '﻿' + lines.join('\r\n');
}

function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

router.get('/leads.csv', requirePermission('relatorios', 'export'), (req, res) => {
  const leads = db.prepare('SELECT * FROM leads ORDER BY name').all();
  const rows = leads.map(l => [l.id, l.name, l.email, l.phone, l.course_interest, l.polo, l.stage, l.temperature, l.source_channel, l.source_type, l.last_interaction_at]);
  const csv = toCsv(['ID', 'Nome', 'Email', 'Telefone', 'Curso de Interesse', 'Polo', 'Etapa', 'Temperatura', 'Canal', 'Origem', 'Última Interação'], rows);
  logAction(req.session.userId, 'export', 'report', null, 'Exportou relatório de leads/alunos (CSV)');
  sendCsv(res, 'relatorio-alunos-leads.csv', csv);
});

router.get('/courses.csv', requirePermission('relatorios', 'export'), (req, res) => {
  const courses = db.prepare('SELECT * FROM courses ORDER BY name').all();
  const rows = courses.map(c => [c.id, c.name, c.modalidade, c.mensalidade, c.carga_horaria, c.coordenador, c.status, c.alunos_ativos]);
  const csv = toCsv(['ID', 'Curso', 'Modalidade', 'Mensalidade', 'Carga Horária', 'Coordenador', 'Status', 'Alunos Ativos'], rows);
  logAction(req.session.userId, 'export', 'report', null, 'Exportou relatório de cursos (CSV)');
  sendCsv(res, 'relatorio-cursos.csv', csv);
});

router.get('/calendar.csv', requirePermission('relatorios', 'export'), (req, res) => {
  const gestor = isGestor(req.session.userId);
  const events = gestor
    ? db.prepare('SELECT * FROM calendar_events ORDER BY starts_at').all()
    : db.prepare('SELECT * FROM calendar_events WHERE owner_user_id = ? ORDER BY starts_at').all(req.session.userId);
  const rows = events.map(e => {
    const owner = db.prepare('SELECT name FROM users WHERE id = ?').get(e.owner_user_id);
    return [e.id, e.title, e.type, e.starts_at, owner ? owner.name : '', e.is_private ? 'Sim' : 'Não'];
  });
  const csv = toCsv(['ID', 'Título', 'Tipo', 'Data/Hora', 'Responsável', 'Privado'], rows);
  logAction(req.session.userId, 'export', 'report', null, 'Exportou relatório de calendário (CSV)');
  sendCsv(res, 'relatorio-calendario.csv', csv);
});

router.get('/audit.csv', requirePermission('configuracoes', 'export'), (req, res) => {
  const logs = db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 2000').all();
  const rows = logs.map(l => {
    const user = l.user_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(l.user_id) : null;
    return [l.id, l.created_at, user ? user.name : 'Sistema', l.action, l.entity, l.entity_id, l.details];
  });
  const csv = toCsv(['ID', 'Data/Hora', 'Usuário', 'Ação', 'Entidade', 'ID da Entidade', 'Detalhes'], rows);
  sendCsv(res, 'log-auditoria.csv', csv);
});

module.exports = router;
