'use strict';

const express = require('express');
const db = require('../db');
const { requirePermission } = require('../permissions');
const { TEMPERATURES } = require('../constants');

const router = express.Router();

router.get('/', requirePermission('insights', 'view'), (req, res) => {
  const totalLeads = db.prepare('SELECT COUNT(*) as c FROM leads').get().c;
  const totalAlunosAtivos = db.prepare("SELECT COALESCE(SUM(alunos_ativos),0) as s FROM courses").get().s;

  const stages = db.prepare('SELECT * FROM stages ORDER BY sort_order ASC').all();
  const byStage = stages.map(s => ({
    key: s.key,
    label: s.label,
    color: s.color,
    count: db.prepare('SELECT COUNT(*) as c FROM leads WHERE stage = ?').get(s.key).c
  }));

  const byTemperature = TEMPERATURES.map(t => ({
    key: t.key,
    label: t.label,
    color: t.color,
    count: db.prepare('SELECT COUNT(*) as c FROM leads WHERE temperature = ?').get(t.key).c
  }));

  const bySourceType = db.prepare('SELECT source_type as key, COUNT(*) as count FROM leads GROUP BY source_type').all();
  const byChannel = db.prepare('SELECT source_channel as key, COUNT(*) as count FROM leads GROUP BY source_channel').all();

  const matriculados = db.prepare("SELECT COUNT(*) as c FROM leads WHERE stage IN ('matricula','ativo','formado')").get().c;
  const evadidos = db.prepare("SELECT COUNT(*) as c FROM leads WHERE stage = 'trancado'").get().c;
  const taxaConversao = totalLeads > 0 ? Math.round((matriculados / totalLeads) * 1000) / 10 : 0;

  const totalCourses = db.prepare('SELECT COUNT(*) as c FROM courses').get().c;
  const totalEvents = db.prepare('SELECT COUNT(*) as c FROM calendar_events').get().c;
  const activeAutomations = db.prepare('SELECT COUNT(*) as c FROM automations WHERE active = 1').get().c;

  res.json({
    kpis: {
      totalLeads,
      totalAlunosAtivos,
      matriculados,
      evadidos,
      taxaConversao,
      totalCourses,
      totalEvents,
      activeAutomations
    },
    byStage,
    byTemperature,
    bySourceType,
    byChannel
  });
});

const leadScoring = require('../ai/leadScoring');

function stageLabelOf(key) { const s = db.prepare('SELECT label FROM stages WHERE key = ?').get(key); return s ? s.label : key; }

// Rule-based "Nexus AI" console. It parses the free-text prompt looking for
// entities it actually has in the database (lead/aluno name, curso, polo,
// datas de hoje) before falling back to generic keyword intents. No external
// AI API is used — see ai/leadScoring.js for the rationale (no key/cost, runs
// fully on this server against real data).
router.post('/ask', requirePermission('agente-ia', 'view'), (req, res) => {
  const rawPrompt = String((req.body && req.body.prompt) || '');
  const prompt = rawPrompt.toLowerCase();
  let reply;

  // 1) Does the prompt name a specific lead/aluno?
  const allLeads = db.prepare('SELECT * FROM leads').all();
  const nameMatch = allLeads.find(l => l.name && prompt.includes(l.name.toLowerCase().split(' ')[0]) && l.name.toLowerCase().split(' ')[0].length > 2);
  const fullNameMatch = allLeads.find(l => l.name && prompt.includes(l.name.toLowerCase()));
  const lead = fullNameMatch || nameMatch;

  // 2) Does the prompt name a specific course? (full name, or a distinctive word from it)
  const allCourses = db.prepare('SELECT * FROM courses').all();
  const course = allCourses.find(c => {
    if (!c.name) return false;
    const lower = c.name.toLowerCase();
    if (prompt.includes(lower)) return true;
    return lower.split(' ').some(w => w.length > 4 && prompt.includes(w));
  });

  // 3) Does the prompt name a specific polo?
  const polos = [...new Set(allLeads.map(l => l.polo).filter(Boolean))];
  const polo = polos.find(p => prompt.includes(p.toLowerCase().split(' - ')[0].toLowerCase()));

  if (lead) {
    const events = db.prepare('SELECT * FROM lead_events WHERE lead_id = ? ORDER BY created_at ASC').all(lead.id);
    const ai = leadScoring.classify(lead, events);
    reply = `${lead.name}: etapa "${stageLabelOf(lead.stage)}", temperatura ${ai.temperature.toUpperCase()}. ${ai.situacao} Sugestão de abordagem: ${ai.abordagem}`;
  } else if (course) {
    const promo = course.promotional_price ? ` (promocional atual: ${course.promotional_price})` : '';
    reply = `${course.name} (${course.modalidade}): mensalidade ${course.mensalidade || 'não informada'}${promo}, ${course.alunos_ativos} aluno(s) ativo(s), coordenado por ${course.coordenador || 'coordenador não definido'}. Status: ${course.status}.`;
  } else if (polo) {
    const count = db.prepare('SELECT COUNT(*) as c FROM leads WHERE polo = ?').get(polo).c;
    const hotInPolo = db.prepare("SELECT COUNT(*) as c FROM leads WHERE polo = ? AND temperature = 'quente'").get(polo).c;
    reply = `O polo ${polo} possui ${count} lead(s)/aluno(s) monitorados, sendo ${hotInPolo} classificado(s) como QUENTE no momento.`;
  } else if (prompt.includes('hoje') || prompt.includes('agenda') || prompt.includes('compromisso')) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const events = db.prepare('SELECT * FROM calendar_events WHERE owner_user_id = ? AND starts_at LIKE ? ORDER BY starts_at ASC').all(req.session.userId, `${todayStr}%`);
    reply = events.length
      ? `Você tem ${events.length} compromisso(s) hoje: ${events.map(e => `${e.title} (${new Date(e.starts_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})`).join('; ')}.`
      : 'Você não tem compromissos registrados para hoje no Calendário Acadêmico.';
  } else if (prompt.includes('evas') || prompt.includes('risco')) {
    const risky = db.prepare(`
      SELECT name, course_interest, polo FROM leads
      WHERE temperature = 'frio' AND stage NOT IN ('trancado','formado')
      ORDER BY last_interaction_at ASC LIMIT 5
    `).all();
    reply = risky.length === 0
      ? 'Nenhum lead/aluno com sinais fortes de risco no momento. A base está saudável.'
      : `Identifiquei ${risky.length} lead(s)/aluno(s) com risco elevado (classificados como frio pela IA): ${risky.map(r => `${r.name} (${r.course_interest || 'curso não informado'})`).join(', ')}. Recomendo contato imediato da equipe comercial ou tutoria.`;
  } else if (prompt.includes('comunicado') || prompt.includes('rematr')) {
    reply = 'Comunicado gerado: "Prezado Aluno UniCesumar, informamos que o período de rematrícula está oficialmente aberto, com condições especiais por tempo limitado. Fale com seu consultor para garantir sua vaga."';
  } else if (prompt.includes('vestibular') || prompt.includes('convers')) {
    const totalLeads = db.prepare('SELECT COUNT(*) as c FROM leads').get().c;
    const matriculados = db.prepare("SELECT COUNT(*) as c FROM leads WHERE stage IN ('matricula','ativo','formado')").get().c;
    const taxa = totalLeads > 0 ? Math.round((matriculados / totalLeads) * 1000) / 10 : 0;
    reply = `A taxa de conversão atual da base é de ${taxa}% (${matriculados} de ${totalLeads} leads efetivaram matrícula).`;
  } else if (prompt.includes('automa')) {
    const list = db.prepare('SELECT name, active FROM automations').all();
    const activeCount = list.filter(a => a.active).length;
    reply = `Existem ${list.length} automação(ões) cadastradas, ${activeCount} ativa(s) no momento: ${list.map(a => `${a.name} (${a.active ? 'ativa' : 'inativa'})`).join('; ')}.`;
  } else if (prompt.includes('morno')) {
    const c = db.prepare("SELECT COUNT(*) as c FROM leads WHERE temperature = 'morno'").get().c;
    reply = `Existem atualmente ${c} lead(s) classificados como MORNO pela IA — candidatos a nutrição ativa antes de esfriarem.`;
  } else if (prompt.includes('frio')) {
    const c = db.prepare("SELECT COUNT(*) as c FROM leads WHERE temperature = 'frio'").get().c;
    reply = `Existem atualmente ${c} lead(s) classificados como FRIO pela IA — considere incluí-los em uma campanha de reativação (Segmentos/Transmissões).`;
  } else if (prompt.includes('quente')) {
    const hot = db.prepare("SELECT COUNT(*) as c FROM leads WHERE temperature = 'quente'").get().c;
    reply = `Existem atualmente ${hot} lead(s) classificados como QUENTE pela IA. Priorize o contato desses leads hoje.`;
  } else if (prompt.includes('quant') && (prompt.includes('lead') || prompt.includes('aluno'))) {
    const totalLeads = db.prepare('SELECT COUNT(*) as c FROM leads').get().c;
    reply = `A base atual possui ${totalLeads} lead(s)/aluno(s) monitorados pela plataforma.`;
  } else if (prompt.includes('curso')) {
    const courses = db.prepare('SELECT name, alunos_ativos FROM courses ORDER BY alunos_ativos DESC').all();
    reply = `Cursos cadastrados: ${courses.map(c => `${c.name} (${c.alunos_ativos} alunos)`).join(', ')}.`;
  } else {
    const totalLeads = db.prepare('SELECT COUNT(*) as c FROM leads').get().c;
    reply = `Não encontrei uma correspondência exata para "${rawPrompt}". A base atual possui ${totalLeads} leads/alunos monitorados. Você pode perguntar pelo nome de um lead, de um curso, de um polo, sobre "evasão", "conversão do vestibular", "automações", "compromissos de hoje" ou pedir um "comunicado de rematrícula".`;
  }

  res.json({ reply });
});

module.exports = router;
