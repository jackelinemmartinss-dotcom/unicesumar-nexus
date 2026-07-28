'use strict';

/*
 * Motor de qualificação de leads (Nexus AI) — 100% baseado em regras
 * determinísticas, sem chamada a nenhuma API externa de IA.
 *
 * Combina: canal/tipo de origem, etapa da jornada, tempo desde a última
 * interação e palavras-chave da última mensagem recebida do lead para
 * produzir uma pontuação 0-100, classificar em quente/morno/frio e gerar
 * um resumo de situação + sugestão de mensagem + abordagem recomendada.
 */

const BUYING_KEYWORDS = ['matricul', 'pagar', 'pagamento', 'boleto', 'vaga', 'desconto', 'inscri', 'quando come', 'bolsa'];
const HESITATION_KEYWORDS = ['caro', 'desistir', 'não tenho interesse', 'nao tenho interesse', 'pensar', 'depois', 'ocupado', 'sem tempo'];

const LATE_STAGES = ['pagamento', 'matricula', 'ativo', 'formado'];
const MID_STAGES = ['documentacao', 'vestibular'];

function daysSince(dateIso) {
  if (!dateIso) return 999;
  const ms = Date.now() - new Date(dateIso).getTime();
  return ms / (1000 * 60 * 60 * 24);
}

function lastInboundUnanswered(events) {
  // events ordered ascending by created_at
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type !== 'message') continue;
    return events[i].direction === 'in';
  }
  return false;
}

function lastInboundMessageText(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'message' && events[i].direction === 'in') return events[i].content || '';
  }
  return '';
}

function classify(lead, events) {
  events = events || [];
  let score = 50;
  const reasons = [];

  if (lead.source_type === 'pago') {
    score += 15;
    reasons.push('origem paga (anúncio) exige resposta mais rápida');
  } else {
    reasons.push('origem orgânica');
  }

  if (LATE_STAGES.includes(lead.stage)) {
    score += 20;
    reasons.push('etapa avançada da jornada');
  } else if (MID_STAGES.includes(lead.stage)) {
    score += 8;
    reasons.push('etapa intermediária da jornada');
  }

  const dias = daysSince(lead.last_interaction_at);
  if (dias <= 1) {
    score += 25;
    reasons.push('interação recente (≤ 1 dia)');
  } else if (dias <= 3) {
    score += 10;
    reasons.push('interação há poucos dias');
  } else if (dias <= 7) {
    score -= 10;
    reasons.push('sem interação há mais de 3 dias');
  } else {
    score -= 30;
    reasons.push('sem interação há mais de uma semana');
  }

  const lastMsg = lastInboundMessageText(events).toLowerCase();
  const hasBuyingSignal = BUYING_KEYWORDS.some(k => lastMsg.includes(k));
  const hasHesitation = HESITATION_KEYWORDS.some(k => lastMsg.includes(k));
  if (hasBuyingSignal) {
    score += 20;
    reasons.push('mensagem com sinal de intenção de compra/matrícula');
  }
  if (hasHesitation) {
    score -= 20;
    reasons.push('mensagem com sinal de hesitação ou objeção');
  }

  const unanswered = lastInboundUnanswered(events);
  if (unanswered && dias > 2) {
    score -= 15;
    reasons.push('lead respondeu e ainda não recebeu retorno');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let temperature = 'frio';
  if (score >= 70) temperature = 'quente';
  else if (score >= 40) temperature = 'morno';

  const situacao = buildSituacao(lead, dias, unanswered, temperature);
  const mensagemSugerida = buildSuggestedMessage(lead, temperature, hasHesitation);
  const abordagem = buildApproach(lead, temperature, unanswered, dias);

  return { score, temperature, reasons, situacao, mensagemSugerida, abordagem };
}

function buildSituacao(lead, dias, unanswered, temperature) {
  const diasTxt = dias >= 999 ? 'nunca interagiu' : `${Math.floor(dias)} dia(s) desde a última interação`;
  const origem = lead.source_type === 'pago' ? 'anúncio pago' : 'busca orgânica';
  const canal = channelLabel(lead.source_channel);
  const pendencia = unanswered ? ' O lead está aguardando retorno.' : '';
  return `Lead classificado como ${temperature.toUpperCase()} (via ${canal}, ${origem}). ${diasTxt}.${pendencia}`;
}

function channelLabel(channel) {
  const map = { instagram: 'Instagram', whatsapp: 'WhatsApp', google: 'Google Ads/Forms', site: 'Formulário do Site', organic: 'Busca Orgânica' };
  return map[channel] || channel;
}

function buildSuggestedMessage(lead, temperature, hasHesitation) {
  const first = (lead.name || '').split(' ')[0];
  const curso = lead.course_interest || 'o curso de interesse';
  if (temperature === 'quente') {
    return `Olá ${first}! Vi que você está bem perto de garantir sua vaga em ${curso}. Posso te ajudar agora mesmo a finalizar a matrícula? Tenho uma condição especial disponível hoje.`;
  }
  if (temperature === 'morno') {
    if (hasHesitation) {
      return `Oi ${first}, tudo bem? Entendo a sua dúvida sobre o investimento em ${curso}. Consigo te mostrar as opções de bolsa e parcelamento que temos disponíveis, topa uma conversa rápida?`;
    }
    return `Oi ${first}! Passando para saber se ainda ficou alguma dúvida sobre ${curso}. Posso te enviar a grade curricular e os próximos passos da inscrição?`;
  }
  return `Olá ${first}, tudo bem? A UniCesumar tem novidades sobre ${curso} e condições especiais nesse período. Quer que eu te envie mais informações?`;
}

function buildApproach(lead, temperature, unanswered, dias) {
  if (temperature === 'quente') {
    return 'Priorizar contato hoje por telefone ou WhatsApp. Lead com alta probabilidade de matrícula imediata — evite deixar para amanhã.';
  }
  if (temperature === 'morno') {
    return unanswered
      ? 'Responder ainda hoje. Enviar material de apoio (grade curricular, valores) e agendar um retorno em 2 dias caso não haja resposta.'
      : 'Manter nutrição ativa: enviar conteúdo relevante sobre o curso e reavaliar em alguns dias.';
  }
  return dias > 7
    ? 'Incluir em campanha de reativação automática (segmentos) em vez de abordagem individual imediata.'
    : 'Baixa prioridade no momento. Monitorar e aguardar sinais de maior intenção antes de investir tempo comercial.';
}

module.exports = { classify };
