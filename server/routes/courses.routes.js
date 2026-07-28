'use strict';

const express = require('express');
const db = require('../db');
const { requirePermission, isGestor } = require('../permissions');
const { logAction } = require('../audit');

const router = express.Router();

function serialize(c) {
  return {
    id: c.id,
    name: c.name,
    modalidade: c.modalidade,
    mensalidade: c.mensalidade,
    promotionalPrice: c.promotional_price,
    cargaHoraria: c.carga_horaria,
    coordenador: c.coordenador,
    status: c.status,
    alunosAtivos: c.alunos_ativos
  };
}

router.get('/', requirePermission('cursos', 'view'), (req, res) => {
  const courses = db.prepare('SELECT * FROM courses ORDER BY name').all().map(serialize);
  res.json({ courses });
});

router.post('/', requirePermission('cursos', 'create'), (req, res) => {
  const { name, modalidade, mensalidade, promotionalPrice, cargaHoraria, coordenador, status } = req.body || {};
  if (!name || !modalidade) return res.status(400).json({ error: 'Nome e modalidade são obrigatórios.' });
  const promo = isGestor(req.session.userId) ? (promotionalPrice || null) : null;
  const result = db.prepare(`
    INSERT INTO courses (name, modalidade, mensalidade, promotional_price, carga_horaria, coordenador, status, alunos_ativos)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `).run(name.trim(), modalidade, mensalidade || null, promo, cargaHoraria || null, coordenador || null, status || 'Ativo');
  logAction(req.session.userId, 'create', 'course', result.lastInsertRowid, `Curso criado: ${name}`);
  res.status(201).json({ course: serialize(db.prepare('SELECT * FROM courses WHERE id = ?').get(result.lastInsertRowid)) });
});

router.put('/:id', requirePermission('cursos', 'edit'), (req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
  if (!course) return res.status(404).json({ error: 'Curso não encontrado.' });
  const { name, modalidade, mensalidade, promotionalPrice, cargaHoraria, coordenador, status, alunosAtivos } = req.body || {};

  if (promotionalPrice !== undefined && !isGestor(req.session.userId)) {
    return res.status(403).json({ error: 'Apenas o Gestor/Admin pode alterar o valor promocional do curso.' });
  }
  const promo = promotionalPrice === undefined ? course.promotional_price : (promotionalPrice || null);

  db.prepare(`
    UPDATE courses SET
      name = COALESCE(?, name), modalidade = COALESCE(?, modalidade), mensalidade = COALESCE(?, mensalidade),
      promotional_price = ?,
      carga_horaria = COALESCE(?, carga_horaria), coordenador = COALESCE(?, coordenador),
      status = COALESCE(?, status), alunos_ativos = COALESCE(?, alunos_ativos)
    WHERE id = ?
  `).run(name || null, modalidade || null, mensalidade || null, promo, cargaHoraria || null, coordenador || null, status || null, alunosAtivos === undefined ? null : alunosAtivos, req.params.id);
  logAction(req.session.userId, 'update', 'course', req.params.id, `Curso atualizado: ${course.name}`);
  res.json({ course: serialize(db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id)) });
});

router.delete('/:id', requirePermission('cursos', 'delete'), (req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
  if (!course) return res.status(404).json({ error: 'Curso não encontrado.' });
  db.prepare('DELETE FROM courses WHERE id = ?').run(req.params.id);
  logAction(req.session.userId, 'delete', 'course', req.params.id, `Curso excluído: ${course.name}`);
  res.json({ ok: true });
});

module.exports = router;
