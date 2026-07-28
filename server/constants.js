'use strict';

const STAGES = [
  { key: 'interessado', label: 'Interessado', color: '#38BDF8' },
  { key: 'inscrito', label: 'Inscrito no Vestibular', color: '#8B5CF6' },
  { key: 'vestibular', label: 'Vestibular Aprovado', color: '#F59E0B' },
  { key: 'documentacao', label: 'Análise de Documentos', color: '#EC4899' },
  { key: 'pagamento', label: 'Pagamento 1ª Mensalidade', color: '#10B981' },
  { key: 'matricula', label: 'Matrícula Efetivada', color: '#0066B3' },
  { key: 'ativo', label: 'Aluno Ativo', color: '#00A3E0' },
  { key: 'trancado', label: 'Aluno Trancado', color: '#94A3B8' },
  { key: 'formado', label: 'Aluno Formado', color: '#6E7A85' }
];

const TEMPERATURES = [
  { key: 'quente', label: 'Quente', color: '#F43F5E' },
  { key: 'morno', label: 'Morno', color: '#F59E0B' },
  { key: 'frio', label: 'Frio', color: '#38BDF8' }
];

const CHANNELS = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'google', label: 'Google Ads/Forms' },
  { key: 'site', label: 'Formulário do Site' },
  { key: 'organic', label: 'Orgânico / Indicação' }
];

const STAGE_KEYS = STAGES.map(s => s.key);
const TEMPERATURE_KEYS = TEMPERATURES.map(t => t.key);
const CHANNEL_KEYS = CHANNELS.map(c => c.key);

module.exports = { STAGES, TEMPERATURES, CHANNELS, STAGE_KEYS, TEMPERATURE_KEYS, CHANNEL_KEYS };
