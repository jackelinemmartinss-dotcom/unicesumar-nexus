'use strict';

const express = require('express');
const db = require('./db');
const { verifyPassword, hashPassword } = require('./crypto-utils');
const { getEffectivePermissions, isGestor } = require('./permissions');
const { logAction } = require('./audit');

const router = express.Router();

function publicUser(userRow) {
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(userRow.role_id);
  const dept = userRow.department_id ? db.prepare('SELECT * FROM departments WHERE id = ?').get(userRow.department_id) : null;
  return {
    id: userRow.id,
    name: userRow.name,
    username: userRow.username,
    role: role ? role.name : null,
    roleId: userRow.role_id,
    department: dept ? dept.name : null,
    departmentId: userRow.department_id,
    theme: userRow.theme,
    avatarInitials: userRow.avatar_initials,
    isGestor: role ? role.name === 'Gestor / Admin' : false
  };
}

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Informe usuário e senha.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(String(username).trim().toLowerCase());
  if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }

  req.session.userId = user.id;
  logAction(user.id, 'login', 'session', user.id, `Login de ${user.name}`);

  res.json({
    user: publicUser(user),
    permissions: getEffectivePermissions(user.id)
  });
});

router.post('/logout', (req, res) => {
  const userId = req.session ? req.session.userId : null;
  if (userId) logAction(userId, 'logout', 'session', userId, 'Logout');
  req.session.destroy(() => {
    res.clearCookie('nexus.sid');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Sessão inválida.' });
  }
  res.json({
    user: publicUser(user),
    permissions: getEffectivePermissions(user.id)
  });
});

router.patch('/me/theme', (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Não autenticado.' });
  const { theme } = req.body || {};
  if (theme !== 'dark' && theme !== 'light') return res.status(400).json({ error: 'Tema inválido.' });
  db.prepare('UPDATE users SET theme = ? WHERE id = ?').run(theme, req.session.userId);
  res.json({ ok: true, theme });
});

router.post('/me/password', (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Não autenticado.' });
  const { currentPassword, newPassword } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !verifyPassword(currentPassword || '', user.password_hash, user.password_salt)) {
    return res.status(401).json({ error: 'Senha atual incorreta.' });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'A nova senha deve ter ao menos 6 caracteres.' });
  }
  const { hash, salt } = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, user.id);
  logAction(user.id, 'update', 'user', user.id, 'Usuário alterou a própria senha');
  res.json({ ok: true });
});

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }
  next();
}

module.exports = { router, requireAuth, publicUser };
