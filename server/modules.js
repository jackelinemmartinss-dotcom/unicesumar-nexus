'use strict';

// Master list of application modules used for permission resolution.
// Order here defines default sidebar order on the front-end.
const MODULES = [
  { key: 'insights', label: 'Insights Executivos' },
  { key: 'comunicacoes', label: 'Comunicações' },
  { key: 'pipelines', label: 'Jornada do Aluno & Funil de Leads' },
  { key: 'calendario', label: 'Calendário Acadêmico' },
  { key: 'cursos', label: 'Cursos & Disciplinas' },
  { key: 'listas', label: 'Diretório & Listas' },
  { key: 'segmentos', label: 'Segmentos & Transmissões' },
  { key: 'agente-ia', label: 'Assistente Nexus AI' },
  { key: 'automacoes', label: 'Automações & Bots' },
  { key: 'relatorios', label: 'Central de Relatórios' },
  { key: 'integracoes', label: 'Hub de Integrações' },
  { key: 'configuracoes', label: 'Configurações & Permissões' }
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
