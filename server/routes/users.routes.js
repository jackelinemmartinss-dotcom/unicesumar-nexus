'use strict';

const express = require('express');
const db = require('../db');
const { requireGestor, getEffectivePermissions } = require('../permissions');
const { hashPassword } = require('../crypto-utils');
const { MODULES, MODULE_KEYS, ACTIONS, fullAccessPermissions, noAccessPermissions } = require('../modules');
const { logAction } = require('../audit');

const router = express.Router();

function initials(name) {
  const parts = String(name).trim().split(/\s+/);
  const first = parts[0] ? parts[0][0] : '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function serializeUser(u) {
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(u.role_id);
  const dept = u.department_id ? db.prepare('SELECT * FROM departments WHERE id = ?').get(u.department_id) : null;
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    roleId: u.role_id,
    role: role ? role.name : null,
    departmentId: u.department_id,
    department: dept ? dept.name : null,
    theme: u.theme,
    avatarInitials: u.avatar_initials,
    active: !!u.active,
    createdAt: u.created_at,
    permissions: getEffectivePermissions(u.id),
    permissionOverrides: db.prepare('SELECT * FROM user_permissions WHERE user_id = ?').all(u.id)
  };
}

// All routes below require Gestor.
router.use(requireGestor);

router.get('/modules', (req, res) => {
  res.json({ modules: MODULES, actions: ACTIONS });
});

// ---------- Roles ----------
router.get('/roles', (req, res) => {
  const roles = db.prepare('SELECT * FROM roles ORDER BY id').all().map(r => ({
    id: r.id, name: r.name, isSystem: !!r.is_system, defaultPermissions: JSON.parse(r.default_permissions)
  }));
  res.json({ roles });
});

router.post('/roles', (req, res) => {
  const { name, defaultPermissions } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nome do cargo é obrigatório.' });
  const perms = defaultPermissions || noAccessPermissions();
  const result = db.prepare('INSERT INTO roles (name, is_system, default_permissions) VALUES (?, 0, ?)').run(name.trim(), JSON.stringify(perms));
  logAction(req.session.userId, 'create', 'role', result.lastInsertRowid, `Cargo criado: ${name}`);
  res.status(201).json({ id: result.lastInsertRowid });
});

router.put('/roles/:id', (req, res) => {
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Cargo não encontrado.' });
  const { name, defaultPermissions } = req.body || {};
  if (role.is_system && name && name !== role.name) {
    return res.status(400).json({ error: 'Não é possível renomear um cargo padrão do sistema.' });
  }
  db.prepare('UPDATE roles SET name = COALESCE(?, name), default_permissions = COALESCE(?, default_permissions) WHERE id = ?')
    .run(name || null, defaultPermissions ? JSON.stringify(defaultPermissions) : null, req.params.id);
  logAction(req.session.userId, 'update', 'role', req.params.id, `Cargo atualizado: ${role.name}`);
  res.json({ ok: true });
});

router.delete('/roles/:id', (req, res) => {
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Cargo não encontrado.' });
  if (role.is_system) return res.status(400).json({ error: 'Cargos padrão do sistema não podem ser excluídos.' });
  const inUse = db.prepare('SELECT COUNT(*) as c FROM users WHERE role_id = ?').get(req.params.id).c;
  if (inUse > 0) return res.status(400).json({ error: 'Existem usuários com este cargo. Reatribua-os antes de excluir.' });
  db.prepare('DELETE FROM roles WHERE id = ?').run(req.params.id);
  logAction(req.session.userId, 'delete', 'role', req.params.id, `Cargo excluído: ${role.name}`);
  res.json({ ok: true });
});

// ---------- Departments ----------
router.get('/departments', (req, res) => {
  const departments = db.prepare('SELECT * FROM departments ORDER BY id').all().map(d => ({
    id: d.id, name: d.name, defaultPermissions: d.default_permissions ? JSON.parse(d.default_permissions) : null
  }));
  res.json({ departments });
});

router.post('/departments', (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nome do departamento é obrigatório.' });
  const result = db.prepare('INSERT INTO departments (name, default_permissions) VALUES (?, NULL)').run(name.trim());
  logAction(req.session.userId, 'create', 'department', result.lastInsertRowid, `Departamento criado: ${name}`);
  res.status(201).json({ id: result.lastInsertRowid });
});

router.put('/departments/:id', (req, res) => {
  const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);
  if (!dept) return res.status(404).json({ error: 'Departamento não encontrado.' });
  const { name, defaultPermissions } = req.body || {};
  db.prepare('UPDATE departments SET name = COALESCE(?, name), default_permissions = ? WHERE id = ?')
    .run(name || null, defaultPermissions === undefined ? dept.default_permissions : (defaultPermissions ? JSON.stringify(defaultPermissions) : null), req.params.id);
  logAction(req.session.userId, 'update', 'department', req.params.id, `Departamento atualizado: ${dept.name}`);
  res.json({ ok: true });
});

router.delete('/departments/:id', (req, res) => {
  const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);
  if (!dept) return res.status(404).json({ error: 'Departamento não encontrado.' });
  db.prepare('UPDATE users SET department_id = NULL WHERE department_id = ?').run(req.params.id);
  db.prepare('DELETE FROM departments WHERE id = ?').run(req.params.id);
  logAction(req.session.userId, 'delete', 'department', req.params.id, `Departamento excluído: ${dept.name}`);
  res.json({ ok: true });
});

// ---------- Users ----------
router.get('/', (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY id').all().map(serializeUser);
  res.json({ users });
});

router.post('/', (req, res) => {
  const { name, username, password, roleId, departmentId, theme } = req.body || {};
  if (!name || !username || !password || !roleId) {
    return res.status(400).json({ error: 'Nome, usuário, senha e cargo são obrigatórios.' });
  }
  const cleanUsername = String(username).trim().toLowerCase();
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
  if (exists) return res.status(409).json({ error: 'Já existe um usuário com este nome de usuário.' });
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(roleId);
  if (!role) return res.status(400).json({ error: 'Cargo inválido.' });

  const { hash, salt } = hashPassword(password);
  const result = db.prepare(`
    INSERT INTO users (name, username, password_hash, password_salt, role_id, department_id, theme, avatar_initials, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(name.trim(), cleanUsername, hash, salt, roleId, departmentId || null, theme === 'light' ? 'light' : 'dark', initials(name), new Date().toISOString());

  logAction(req.session.userId, 'create', 'user', result.lastInsertRowid, `Usuário criado: ${name} (${cleanUsername})`);
  const created = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ user: serializeUser(created) });
});

router.put('/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const { name, roleId, departmentId, active } = req.body || {};

  db.prepare(`
    UPDATE users SET
      name = COALESCE(?, name),
      role_id = COALESCE(?, role_id),
      department_id = ?,
      active = COALESCE(?, active)
    WHERE id = ?
  `).run(
    name || null,
    roleId || null,
    departmentId === undefined ? user.department_id : (departmentId || null),
    active === undefined ? null : (active ? 1 : 0),
    req.params.id
  );

  logAction(req.session.userId, 'update', 'user', req.params.id, `Usuário atualizado: ${user.name}`);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  res.json({ user: serializeUser(updated) });
});

router.delete('/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (Number(req.params.id) === req.session.userId) {
    return res.status(400).json({ error: 'Você não pode excluir a própria conta.' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  logAction(req.session.userId, 'delete', 'user', req.params.id, `Usuário excluído: ${user.name}`);
  res.json({ ok: true });
});

router.post('/:id/reset-password', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'A nova senha deve ter ao menos 6 caracteres.' });
  }
  const { hash, salt } = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, req.params.id);
  logAction(req.session.userId, 'update', 'user', req.params.id, `Senha redefinida para: ${user.name}`);
  res.json({ ok: true });
});

// ---------- Per-user permission overrides ----------
router.put('/:id/permissions', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const { permissions } = req.body || {};
  if (!permissions || typeof permissions !== 'object') {
    return res.status(400).json({ error: 'Permissões inválidas.' });
  }

  const upsert = db.prepare(`
    INSERT INTO user_permissions (user_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, module_key) DO UPDATE SET
      can_view = excluded.can_view,
      can_create = excluded.can_create,
      can_edit = excluded.can_edit,
      can_delete = excluded.can_delete,
      can_export = excluded.can_export
  `);

  for (const key of MODULE_KEYS) {
    const p = permissions[key];
    if (!p) continue;
    upsert.run(req.params.id, key, p.view ? 1 : 0, p.create ? 1 : 0, p.edit ? 1 : 0, p.delete ? 1 : 0, p.export ? 1 : 0);
  }

  logAction(req.session.userId, 'update', 'permissions', req.params.id, `Permissões individuais atualizadas para: ${user.name}`);
  res.json({ permissions: getEffectivePermissions(req.params.id) });
});

router.delete('/:id/permissions', (req, res) => {
  db.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(req.params.id);
  logAction(req.session.userId, 'update', 'permissions', req.params.id, 'Permissões individuais removidas (voltou ao padrão do cargo)');
  res.json({ permissions: getEffectivePermissions(req.params.id) });
});

module.exports = router;
