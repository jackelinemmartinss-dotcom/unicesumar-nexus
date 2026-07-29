'use strict';

// Master list of application modules used for permission resolution.
// Order here defines default sidebar order on the front-end.
const MODULES = [
  { key: 'insights', label: 'Dashboard' },
  { key: 'comunicacoes', label: 'Comunicações' },
  { key: 'pipelines', label: 'Jornada do Lead' },
  { key: 'calendario', label: 'Calendário Acadêmico' },
  { key: 'cursos', label: 'Cursos e Disciplinas' },
  { key: 'listas', label: 'Diretório e Listas' },
  { key: 'segmentos', label: 'Segmentos e Transmissões' },
  { key: 'agente-ia', label: 'Assistente Nexus AI' },
  { key: 'automacoes', label: 'Automações e Bots' },
  { key: 'relatorios', label: 'Central de Relatórios' },
  { key: 'integracoes', label: 'Hub de Integrações' },
  { key: 'configuracoes', label: 'Configurações e Permissões' }
];

const MODULE_KEYS = MODULES.map(m => m.key);

const ACTIONS = ['view', 'create', 'edit', 'delete', 'export'];

function fullAccessPermissions() {
  const perms = {};
  for (const key of MODULE_KEYS) {
    perms[key] = { view: true, create: true, edit: true, delete: true, export: true };
  }
  return perms;
}

function noAccessPermissions() {
  const perms = {};
  for (const key of MODULE_KEYS) {
    perms[key] = { view: false, create: false, edit: false, delete: false, export: false };
  }
  return perms;
}

module.exports = { MODULES, MODULE_KEYS, ACTIONS, fullAccessPermissions, noAccessPermissions };
