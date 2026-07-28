'use strict';

const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./crypto-utils');
const { fullAccessPermissions } = require('./modules');
const { STAGES } = require('./constants');
const leadScoring = require('./ai/leadScoring');

const DB_PATH = path.join(__dirname, '..', 'nexus.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    is_system INTEGER NOT NULL DEFAULT 0,
    default_permissions TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    default_permissions TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role_id INTEGER NOT NULL REFERENCES roles(id),
    department_id INTEGER REFERENCES departments(id),
    theme TEXT NOT NULL DEFAULT 'dark',
    avatar_initials TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    module_key TEXT NOT NULL,
    can_view INTEGER NOT NULL DEFAULT 0,
    can_create INTEGER NOT NULL DEFAULT 0,
    can_edit INTEGER NOT NULL DEFAULT 0,
    can_delete INTEGER NOT NULL DEFAULT 0,
    can_export INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, module_key)
  );

  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    course_interest TEXT,
    polo TEXT,
    stage TEXT NOT NULL DEFAULT 'interessado',
    temperature TEXT NOT NULL DEFAULT 'morno',
    temperature_locked INTEGER NOT NULL DEFAULT 0,
    source_channel TEXT NOT NULL DEFAULT 'site',
    source_type TEXT NOT NULL DEFAULT 'organico',
    owner_user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_interaction_at TEXT
  );

  CREATE TABLE IF NOT EXISTS lead_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    channel TEXT,
    content TEXT,
    direction TEXT,
    author_user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'Geral',
    starts_at TEXT NOT NULL,
    is_private INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS calendar_event_shares (
    event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#94A3B8',
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    modalidade TEXT NOT NULL,
    mensalidade TEXT,
    carga_horaria TEXT,
    coordenador TEXT,
    status TEXT NOT NULL DEFAULT 'Ativo',
    alunos_ativos INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS integrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'disconnected',
    connected_at TEXT,
    meta TEXT
  );

  CREATE TABLE IF NOT EXISTS automations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    trigger_desc TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    run_count INTEGER NOT NULL DEFAULT 0,
    last_run_at TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    details TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS broadcasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filter_type TEXT NOT NULL,
    filter_value TEXT NOT NULL,
    message TEXT NOT NULL,
    sent_by_user_id INTEGER REFERENCES users(id),
    reached_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_by_user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_group_members (
    group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS chat_group_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
    author_user_id INTEGER REFERENCES users(id),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// --- Additive migrations for columns introduced after the initial release ---
function ensureColumn(table, column, ddlType) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddlType}`);
  }
}
ensureColumn('courses', 'promotional_price', 'TEXT');

// Stages are seeded independently of seedIfEmpty() so existing databases
// (created before stage management existed) get backfilled on next boot.
function seedStagesIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) as c FROM stages').get().c;
  if (count > 0) return;
  const insertStage = db.prepare('INSERT INTO stages (key, label, color, sort_order) VALUES (?, ?, ?, ?)');
  STAGES.forEach((s, idx) => insertStage.run(s.key, s.label, s.color, idx));
}
seedStagesIfEmpty();

function nowIso() {
  return new Date().toISOString();
}

function daysAgoIso(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

function seedIfEmpty() {
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (userCount > 0) return;

  // --- Roles ---
  const gestorPerms = fullAccessPermissions();

  const colaboradorPerms = {
    insights: { view: true, create: false, edit: false, delete: false, export: false },
    comunicacoes: { view: true, create: true, edit: true, delete: false, export: false },
    pipelines: { view: true, create: true, edit: true, delete: false, export: false },
    calendario: { view: true, create: true, edit: true, delete: true, export: false },
    cursos: { view: true, create: false, edit: false, delete: false, export: false },
    listas: { view: true, create: true, edit: true, delete: false, export: false },
    segmentos: { view: false, create: false, edit: false, delete: false, export: false },
    'agente-ia': { view: true, create: false, edit: false, delete: false, export: false },
    automacoes: { view: false, create: false, edit: false, delete: false, export: false },
    relatorios: { view: false, create: false, edit: false, delete: false, export: false },
    integracoes: { view: false, create: false, edit: false, delete: false, export: false },
    configuracoes: { view: false, create: false, edit: false, delete: false, export: false }
  };

  const tutorPerms = {
    insights: { view: false, create: false, edit: false, delete: false, export: false },
    comunicacoes: { view: true, create: true, edit: true, delete: false, export: false },
    pipelines: { view: false, create: false, edit: false, delete: false, export: false },
    calendario: { view: true, create: true, edit: true, delete: true, export: false },
    cursos: { view: true, create: false, edit: false, delete: false, export: false },
    listas: { view: true, create: false, edit: false, delete: false, export: false },
    segmentos: { view: false, create: false, edit: false, delete: false, export: false },
    'agente-ia': { view: true, create: false, edit: false, delete: false, export: false },
    automacoes: { view: false, create: false, edit: false, delete: false, export: false },
    relatorios: { view: false, create: false, edit: false, delete: false, export: false },
    integracoes: { view: false, create: false, edit: false, delete: false, export: false },
    configuracoes: { view: false, create: false, edit: false, delete: false, export: false }
  };

  const insertRole = db.prepare('INSERT INTO roles (name, is_system, default_permissions) VALUES (?, ?, ?)');
  const gestorRoleId = insertRole.run('Gestor / Admin', 1, JSON.stringify(gestorPerms)).lastInsertRowid;
  const colaboradorRoleId = insertRole.run('Colaborador Admissões', 1, JSON.stringify(colaboradorPerms)).lastInsertRowid;
  const tutorRoleId = insertRole.run('Tutor EAD', 1, JSON.stringify(tutorPerms)).lastInsertRowid;

  // --- Departments ---
  const insertDept = db.prepare('INSERT INTO departments (name, default_permissions) VALUES (?, ?)');
  const deptComercial = insertDept.run('Admissões Comercial', null).lastInsertRowid;
  const deptTutoria = insertDept.run('Tutoria EAD', null).lastInsertRowid;
  const deptGestao = insertDept.run('Gestão Acadêmica', null).lastInsertRowid;

  // --- Users ---
  const insertUser = db.prepare(`
    INSERT INTO users (name, username, password_hash, password_salt, role_id, department_id, theme, avatar_initials, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);

  const elenaPw = hashPassword('Gestor@123');
  const elenaId = insertUser.run('Clodoaldo', 'clodoaldo', elenaPw.hash, elenaPw.salt, gestorRoleId, deptGestao, 'dark', 'CL', nowIso()).lastInsertRowid;

  const lucasPw = hashPassword('Colab@123');
  const lucasId = insertUser.run('Lucas Silva', 'lucas.silva', lucasPw.hash, lucasPw.salt, colaboradorRoleId, deptComercial, 'dark', 'LS', nowIso()).lastInsertRowid;

  const camilaPw = hashPassword('Tutor@123');
  const camilaId = insertUser.run('Profa. Camila Torres', 'camila.torres', camilaPw.hash, camilaPw.salt, tutorRoleId, deptTutoria, 'light', 'CT', nowIso()).lastInsertRowid;

  // --- Courses ---
  const insertCourse = db.prepare(`
    INSERT INTO courses (name, modalidade, mensalidade, carga_horaria, coordenador, status, alunos_ativos)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertCourse.run('Engenharia de Software', 'EAD', 'R$ 590,00', '3.600h', 'Dr. Roberto Campos', 'Ativo', 2480);
  insertCourse.run('Medicina e Ciências da Saúde', 'Semipresencial', 'R$ 4.850,00', '7.200h', 'Dra. Patricia Alencar', 'Ativo', 620);
  insertCourse.run('Administração de Empresas', 'EAD', 'R$ 380,00', '3.200h', 'Prof. Marcelo Torres', 'Ativo', 3150);
  insertCourse.run('MBA em Inteligência Artificial & Data Science', 'EAD (Pós)', 'R$ 720,00', '480h', 'Dr. Lucas Viana', 'Ativo', 1120);

  // --- Integrations ---
  const insertIntegration = db.prepare('INSERT INTO integrations (key, status, connected_at, meta) VALUES (?, ?, ?, ?)');
  insertIntegration.run('whatsapp', 'connected', nowIso(), JSON.stringify({ numero: '+55 44 99120-0000' }));
  insertIntegration.run('site', 'connected', nowIso(), JSON.stringify({ formulario: 'Landing Page Vestibular 2026/2' }));
  insertIntegration.run('instagram', 'disconnected', null, JSON.stringify({}));
  insertIntegration.run('google', 'disconnected', null, JSON.stringify({}));

  // --- Automations ---
  const insertAutomation = db.prepare(`
    INSERT INTO automations (name, description, trigger_desc, active, run_count, last_run_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertAutomation.run('Lembrete Automático de Mensalidades (D-3)', 'Disparo via WhatsApp 3 dias antes do vencimento do boleto.', 'D-3 antes do vencimento', 1, 1840, daysAgoIso(1));
  insertAutomation.run('Boas-Vindas & Envio de Acesso ao AVA', 'Disparado após confirmação do pagamento da 1ª mensalidade.', 'Pagamento confirmado', 1, 420, daysAgoIso(2));
  insertAutomation.run('Lembrete de Vestibular Online', 'Envio de lembrete 24h antes da aplicação do vestibular.', 'D-1 antes do vestibular', 1, 96, daysAgoIso(5));
  insertAutomation.run('Alerta de Frequência Mínima no AVA (< 75%)', 'Notifica tutoria quando frequência do aluno cai abaixo de 75%.', 'Frequência < 75%', 0, 12, daysAgoIso(20));

  // --- Calendar events ---
  const insertEvent = db.prepare(`
    INSERT INTO calendar_events (owner_user_id, title, type, starts_at, is_private)
    VALUES (?, ?, ?, ?, ?)
  `);
  const in2h = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const tomorrow9 = new Date(Date.now() + 22 * 60 * 60 * 1000).toISOString();
  const thu = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const fri = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();

  insertEvent.run(lucasId, 'Atendimento de Matrícula - Ana Clara Santos', 'Atendimento', in2h, 1);
  insertEvent.run(elenaId, 'Reunião de Coordenação Pedagógica - Polo Botucatu', 'Gestão', in2h, 0);
  insertEvent.run(elenaId, 'Aplicação de Vestibular Online EAD', 'Vestibular', tomorrow9, 0);
  insertEvent.run(camilaId, 'Tutoria Interativa ao Vivo - Eng. Software', 'Aula', thu, 1);
  insertEvent.run(elenaId, 'Conselho de Classe e Análise de Evasão', 'Gestão', fri, 0);
  insertEvent.run(lucasId, 'Ligação de Follow-up - Candidatos Medicina', 'Atendimento', fri, 1);

  // --- Leads (candidatos/alunos) ---
  const insertLead = db.prepare(`
    INSERT INTO leads (name, email, phone, course_interest, polo, stage, temperature, temperature_locked, source_channel, source_type, owner_user_id, created_at, updated_at, last_interaction_at)
    VALUES (?, ?, ?, ?, ?, ?, 'morno', 0, ?, ?, ?, ?, ?, ?)
  `);
  const insertLeadEvent = db.prepare(`
    INSERT INTO lead_events (lead_id, type, channel, content, direction, author_user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const updateLeadScore = db.prepare('UPDATE leads SET temperature = ? WHERE id = ?');

  const seedLeads = [
    { name: 'Ana Clara Santos', email: 'ana.santos@aluno.unicesumar.edu.br', phone: '(14) 99841-2041', course: 'Engenharia de Software', polo: 'Botucatu - SP', stage: 'matricula', channel: 'whatsapp', type: 'pago', owner: lucasId, lastMsg: 'Enviei o comprovante da primeira parcela, pode confirmar?', daysAgo: 0 },
    { name: 'Marcos Vinicius Oliveira', email: 'marcos.v@gmail.com', phone: '(44) 99120-4912', course: 'Medicina', polo: 'Maringá - PR', stage: 'vestibular', channel: 'google', type: 'pago', owner: lucasId, lastMsg: 'Quando começam as aulas de anatomia presenciais?', daysAgo: 1 },
    { name: 'Juliana Paes Mendes', email: 'juliana.paes@outlook.com', phone: '(14) 98112-9034', course: 'Administração de Empresas', polo: 'Botucatu - SP', stage: 'inscrito', channel: 'instagram', type: 'organico', owner: lucasId, lastMsg: 'Ainda estou pensando, achei meio caro pra mim agora.', daysAgo: 6 },
    { name: 'Gabriel Henrique Costa', email: 'gabriel.costa@tech.com', phone: '(41) 99741-0021', course: 'MBA em Inteligência Artificial & Data Science', polo: 'Curitiba - PR', stage: 'ativo', channel: 'site', type: 'organico', owner: elenaId, lastMsg: 'Obrigado pelo suporte, já estou com acesso ao AVA.', daysAgo: 10 },
    { name: 'Beatriz Lima Souza', email: 'beatriz.lima@gmail.com', phone: '(14) 99652-1189', course: 'Pedagogia', polo: 'Botucatu - SP', stage: 'documentacao', channel: 'whatsapp', type: 'organico', owner: lucasId, lastMsg: 'Já enviei o histórico do ensino médio, falta mais algo?', daysAgo: 2 },
    { name: 'Rafael Augusto Lima', email: 'rafael.lima@gmail.com', phone: '(14) 99011-2233', course: 'Engenharia de Software', polo: 'Botucatu - SP', stage: 'interessado', channel: 'instagram', type: 'pago', owner: lucasId, lastMsg: 'Vi o anúncio de vocês, tem desconto para quem se matricular essa semana?', daysAgo: 0 },
    { name: 'Camila Rocha Ferreira', email: 'camila.rocha@gmail.com', phone: '(44) 99022-3344', course: 'Medicina', polo: 'Maringá - PR', stage: 'interessado', channel: 'google', type: 'pago', owner: elenaId, lastMsg: 'Quero saber mais sobre a mensalidade e o processo seletivo.', daysAgo: 0 },
    { name: 'Thiago Nascimento Alves', email: 'thiago.alves@gmail.com', phone: '(14) 99033-4455', course: 'Administração de Empresas', polo: 'São Paulo Jardins - SP', stage: 'inscrito', channel: 'site', type: 'organico', owner: lucasId, lastMsg: 'Ok, vou esperar mais um pouco antes de decidir.', daysAgo: 9 },
    { name: 'Larissa Martins Dias', email: 'larissa.martins@gmail.com', phone: '(44) 99044-5566', course: 'MBA em Inteligência Artificial & Data Science', polo: 'Curitiba - PR', stage: 'vestibular', channel: 'whatsapp', type: 'organico', owner: elenaId, lastMsg: 'Perfeito, me manda o boleto da primeira parcela!', daysAgo: 0 },
    { name: 'Eduardo Santos Barros', email: 'eduardo.barros@gmail.com', phone: '(14) 99055-6677', course: 'Pedagogia', polo: 'Botucatu - SP', stage: 'interessado', channel: 'instagram', type: 'organico', owner: lucasId, lastMsg: 'Vou esperar o próximo semestre, não tenho tempo agora.', daysAgo: 15 },
    { name: 'Patrícia Gomes Rezende', email: 'patricia.rezende@gmail.com', phone: '(41) 99066-7788', course: 'Engenharia de Software', polo: 'Curitiba - PR', stage: 'documentacao', channel: 'google', type: 'pago', owner: lucasId, lastMsg: 'Segue em anexo meu RG e comprovante de residência.', daysAgo: 1 },
    { name: 'Vinícius Almeida Cruz', email: 'vinicius.cruz@gmail.com', phone: '(14) 99077-8899', course: 'Medicina', polo: 'Botucatu - SP', stage: 'inscrito', channel: 'site', type: 'organico', owner: elenaId, lastMsg: 'Qual o valor da inscrição no vestibular?', daysAgo: 4 }
  ];

  for (const sl of seedLeads) {
    const createdAt = daysAgoIso(sl.daysAgo + 3);
    const lastInteractionAt = daysAgoIso(sl.daysAgo);
    const leadId = insertLead.run(
      sl.name, sl.email, sl.phone, sl.course, sl.polo, sl.stage,
      sl.channel, sl.type, sl.owner, createdAt, nowIso(), lastInteractionAt
    ).lastInsertRowid;

    insertLeadEvent.run(leadId, 'system', sl.channel, `Lead capturado via ${sl.channel} (${sl.type === 'pago' ? 'anúncio pago' : 'orgânico'}).`, null, null, createdAt);
    insertLeadEvent.run(leadId, 'message', sl.channel, sl.lastMsg, 'in', null, lastInteractionAt);

    const leadRow = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
    const events = db.prepare('SELECT * FROM lead_events WHERE lead_id = ? ORDER BY created_at ASC').all(leadId);
    const result = leadScoring.classify(leadRow, events);
    updateLeadScore.run(result.temperature, leadId);
  }

  // --- Team chat: default group with all seeded users ---
  const groupId = db.prepare('INSERT INTO chat_groups (name, created_by_user_id, created_at) VALUES (?, ?, ?)')
    .run('Equipe Geral - Polo Botucatu', elenaId, nowIso()).lastInsertRowid;
  const insertMember = db.prepare('INSERT INTO chat_group_members (group_id, user_id) VALUES (?, ?)');
  insertMember.run(groupId, elenaId);
  insertMember.run(groupId, lucasId);
  insertMember.run(groupId, camilaId);
  db.prepare(`
    INSERT INTO chat_group_messages (group_id, author_user_id, content, created_at)
    VALUES (?, ?, ?, ?)
  `).run(groupId, elenaId, 'Bom dia, equipe! Bora fechar as metas de matrícula desse semestre 💪', daysAgoIso(1));

  console.log('[db] Banco inicializado e populado com dados de demonstração.');
}

seedIfEmpty();

module.exports = db;
