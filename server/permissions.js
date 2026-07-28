'use strict';

const db = require('./db');
const { MODULE_KEYS, ACTIONS, fullAccessPermissions } = require('./modules');

function parsePerms(json) {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Resolves the effective permission set for a user: per-user override wins,
 * then department default, then role default. Gestor role always gets
 * full access regardless of stored data (safety net so the admin can never
 * lock themselves out).
 */
function getEffectivePermissions(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return null;

  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(user.role_id);
  if (role && role.name === 'Gestor / Admin') {
    return fullAccessPermissions();
  }

  const rolePerms = parsePerms(role ? role.default_permissions : null) || {};
  const dept = user.department_id ? db.prepare('SELECT * FROM departments WHERE id = ?').get(user.department_id) : null;
  const deptPerms = parsePerms(dept ? dept.default_permissions : null);

  const overrides = db.prepare('SELECT * FROM user_permissions WHERE user_id = ?').all(userId);
  const overrideMap = {};
  for (const o of overrides) overrideMap[o.module_key] = o;

  const effective = {};
  for (const key of MODULE_KEYS) {
    const base = (deptPerms && deptPerms[key]) || rolePerms[key] || { view: false, create: false, edit: false, delete: false, export: false };
    const override = overrideMap[key];
    if (override) {
      effective[key] = {
        view: !!override.can_view,
        create: !!override.can_create,
        edit: !!override.can_edit,
        delete: !!override.can_delete,
        export: !!override.can_export
      };
    } else {
      effective[key] = { ...base };
    }
  }
  return effective;
}

function isGestor(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return false;
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(user.role_id);
  return !!role && role.name === 'Gestor / Admin';
}

/** Express middleware factory: requires the session user to have `action` on `moduleKey`. */
function requirePermission(moduleKey, action) {
  if (!MODULE_KEYS.includes(moduleKey)) throw new Error(`Módulo desconhecido: ${moduleKey}`);
  if (!ACTIONS.includes(action)) throw new Error(`Ação desconhecida: ${action}`);

  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Não autenticado.' });
    }
    const perms = getEffectivePermissions(req.session.userId);
    if (!perms || !perms[moduleKey] || !perms[moduleKey][action]) {
      return res.status(403).json({ error: 'Você não tem permissão para executar esta ação.' });
    }
    next();
  };
}

function requireGestor(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }
  if (!isGestor(req.session.userId)) {
    return res.status(403).json({ error: 'Apenas o Gestor/Admin pode executar esta ação.' });
  }
  next();
}

module.exports = { getEffectivePermissions, isGestor, requirePermission, requireGestor };
