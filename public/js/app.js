/* ==========================================================================
   UNICESUMAR NEXUS ENTERPRISE - FRONT-END APPLICATION ENGINE
   Talks to the real Express/SQLite backend via NexusAPI (js/api.js).
   ========================================================================== */
(function () {
  'use strict';

  const api = window.NexusAPI;

  // Stages (Jornada do Lead) are now fully dynamic and managed by the Gestor —
  // see state.stagesCache, loaded from /api/stages at startup and refreshed
  // after any create/edit/reorder/delete.
  const STAGE_COLOR_OPTIONS = ['#38BDF8', '#8B5CF6', '#F59E0B', '#EC4899', '#10B981', '#0066B3', '#00A3E0', '#94A3B8', '#6E7A85', '#F43F5E'];
  const TEMPERATURES = [
    { key: 'quente', label: 'Quente', color: '#F43F5E' },
    { key: 'morno', label: 'Morno', color: '#F59E0B' },
    { key: 'frio', label: 'Frio', color: '#38BDF8' }
  ];
  const CHANNEL_LABELS = { instagram: 'Instagram', whatsapp: 'WhatsApp', google: 'Google Ads/Forms', site: 'Site', organic: 'Orgânico' };
  const CHANNEL_ICONS = { instagram: 'instagram', whatsapp: 'message-circle', google: 'search', site: 'globe', organic: 'compass' };
  const MODULE_ORDER = ['insights', 'comunicacoes', 'pipelines', 'calendario', 'cursos', 'listas', 'agente-ia', 'automacoes', 'relatorios', 'integracoes', 'configuracoes'];

  const state = {
    user: null,
    permissions: null,
    modulesMeta: null,
    currentModule: 'insights',
    pipelinesTab: 'stage',
    leadsCache: [],
    coursesCache: [],
    automationsCache: [],
    integrationsCache: [],
    stagesCache: [],
    usersCache: [],
    rolesCache: [],
    deptsCache: [],
    selectedThreadLeadId: null,
    configTab: 'usuarios',
    configPermUserId: null,
    commsTab: 'inbox',
    inboxLeftView: 'conversas',
    inboxChannelFilter: 'todos',
    selectedBroadcastListId: null,
    selectedTeamGroupId: null,
    contactsFilters: { name: '', course: '', polo: '', stage: '', temperature: '' },
    calendarTab: 'hoje',
    calendarMembersCache: null,
    calendarEventsCache: []
  };

  /* ---------------------------- helpers ---------------------------- */
  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  }

  function fmtRelative(iso) {
    if (!iso) return '—';
    const diffMs = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diffMs / 86400000);
    if (days <= 0) {
      const hours = Math.floor(diffMs / 3600000);
      if (hours <= 0) return 'agora há pouco';
      return `há ${hours}h`;
    }
    return `há ${days} dia(s)`;
  }

  function stageLabel(key) { const s = state.stagesCache.find(x => x.key === key); return s ? s.label : key; }
  function tempInfo(key) { return TEMPERATURES.find(x => x.key === key) || { label: key, color: '#94A3B8' }; }
  function channelLabel(key) { return CHANNEL_LABELS[key] || key; }

  // Small inline badge shown right next to a lead/contact name: channel icon,
  // plus an "Anúncio" tag when the lead came from a paid ad (vs. organic).
  function sourceIconHtml(lead) {
    const icon = CHANNEL_ICONS[lead.sourceChannel] || 'radio';
    const title = `${channelLabel(lead.sourceChannel)}${lead.sourceType === 'pago' ? ' · Anúncio' : ' · Orgânico'}`;
    const adTag = lead.sourceType === 'pago' ? `<span class="ad-tag">Anúncio</span>` : '';
    return `<span class="source-inline" title="${esc(title)}">${adTag}<i data-feather="${icon}" class="source-icon"></i></span>`;
  }

  function showToast(message, type) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type || 'info'}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4200);
  }

  function refreshIcons() { if (window.feather) window.feather.replace(); }

  // On phones, chat-style modules show either the list or the open item, never
  // both stacked — see .chat-layout.mobile-open in the mobile media query.
  function enterMobileChatView() {
    const layout = document.querySelector('.chat-layout');
    if (layout) layout.classList.add('mobile-open');
  }
  function chatBackButtonHtml() {
    return `<button type="button" class="chat-back-btn" id="chat-back-btn"><i data-feather="arrow-left"></i> Voltar para a lista</button>`;
  }

  function can(moduleKey, action) {
    return !!(state.permissions && state.permissions[moduleKey] && state.permissions[moduleKey][action]);
  }

  /* ---------------------------- generic form modal ---------------------------- */
  function closeFormModal() {
    const overlay = document.getElementById('form-modal-overlay');
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
  }

  function openFormModal({ title, fields, submitLabel, onSubmit, extraHtml }) {
    const overlay = document.getElementById('form-modal-overlay');
    const fieldsHtml = fields.map(f => renderField(f)).join('');

    overlay.innerHTML = `
      <div class="form-modal-dialog">
        <div class="form-modal-header">
          <h3>${esc(title)}</h3>
          <span class="close-modal-btn" id="fm-close" style="cursor:pointer; font-size:1.3rem; color:var(--text-muted)">&times;</span>
        </div>
        <form id="fm-form">
          <div class="form-modal-body">
            <div id="fm-error" class="form-error" style="display:none;"></div>
            ${fieldsHtml}
            ${extraHtml || ''}
          </div>
          <div class="form-modal-footer">
            <button type="button" class="btn btn-secondary" id="fm-cancel">Cancelar</button>
            <button type="submit" class="btn btn-primary" id="fm-submit">${esc(submitLabel || 'Salvar')}</button>
          </div>
        </form>
      </div>
    `;
    overlay.classList.remove('hidden');
    refreshIcons();

    function close() { closeFormModal(); }
    overlay.querySelector('#fm-close').addEventListener('click', close);
    overlay.querySelector('#fm-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('#fm-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorBox = overlay.querySelector('#fm-error');
      errorBox.style.display = 'none';
      const values = {};
      fields.forEach(f => {
        const el = overlay.querySelector(`[name="${f.name}"]`);
        if (!el) return;
        if (f.type === 'checkbox') values[f.name] = el.checked;
        else values[f.name] = el.value;
      });
      const submitBtn = overlay.querySelector('#fm-submit');
      submitBtn.disabled = true;
      try {
        const result = await onSubmit(values, overlay);
        submitBtn.disabled = false;
        if (result !== 'keep-open') close();
      } catch (err) {
        errorBox.textContent = err.message || 'Erro inesperado.';
        errorBox.style.display = 'block';
        submitBtn.disabled = false;
      }
    });

    return overlay;
  }

  function renderField(f) {
    const value = f.value !== undefined && f.value !== null ? f.value : '';
    const required = f.required ? 'required' : '';
    let control = '';
    if (f.type === 'select') {
      const opts = (f.options || []).map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
      control = `<select name="${f.name}" ${required}>${opts}</select>`;
    } else if (f.type === 'textarea') {
      control = `<textarea name="${f.name}" ${required} placeholder="${esc(f.placeholder || '')}">${esc(value)}</textarea>`;
    } else if (f.type === 'checkbox') {
      return `<div class="checkbox-row"><input type="checkbox" name="${f.name}" id="fld-${f.name}" ${value ? 'checked' : ''}><label for="fld-${f.name}">${esc(f.label)}</label></div>`;
    } else {
      control = `<input type="${f.type || 'text'}" name="${f.name}" value="${esc(value)}" placeholder="${esc(f.placeholder || '')}" ${required}>`;
    }
    return `<div class="form-group"><label>${esc(f.label)}</label>${control}${f.hint ? `<span class="form-hint">${esc(f.hint)}</span>` : ''}</div>`;
  }

  function confirmAction(message) { return window.confirm(message); }

  /* ---------------------------- permission matrix builder ---------------------------- */
  function buildPermMatrixHtml(matrix, idPrefix) {
    if (!state.modulesMeta) return '';
    const rows = state.modulesMeta.modules.map(m => {
      const perm = (matrix && matrix[m.key]) || {};
      const cells = state.modulesMeta.actions.map(a => `
        <td><input type="checkbox" data-perm-module="${m.key}" data-perm-action="${a}" ${perm[a] ? 'checked' : ''}></td>
      `).join('');
      return `<tr><td>${esc(m.label)}</td>${cells}</tr>`;
    }).join('');

    const header = state.modulesMeta.actions.map(a => `<th>${esc(actionLabel(a))}</th>`).join('');
    return `
      <div class="perm-matrix-wrapper" id="${idPrefix}">
        <table class="perm-matrix">
          <thead><tr><th>Módulo</th>${header}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function actionLabel(a) {
    return { view: 'Ver', create: 'Criar', edit: 'Editar', delete: 'Excluir', export: 'Exportar' }[a] || a;
  }

  function readPermMatrixFromDom(wrapperId) {
    const wrapper = document.getElementById(wrapperId);
    const result = {};
    state.modulesMeta.modules.forEach(m => { result[m.key] = { view: false, create: false, edit: false, delete: false, export: false }; });
    wrapper.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      const mod = cb.getAttribute('data-perm-module');
      const act = cb.getAttribute('data-perm-action');
      result[mod][act] = cb.checked;
    });
    return result;
  }

  async function ensureModulesMeta() {
    if (state.modulesMeta) return;
    try {
      state.modulesMeta = await api.get('/users/modules');
    } catch { state.modulesMeta = { modules: [], actions: [] }; }
  }

  /* ---------------------------- bootstrap ---------------------------- */
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    let me;
    try {
      me = await api.get('/auth/me');
    } catch (e) {
      return; // api.js already redirected to /login.html
    }
    state.user = me.user;
    state.permissions = me.permissions;

    applyTheme(state.user.theme);
    renderUserHeader();
    applySidebarPermissions();
    bindGlobalUI();
    refreshIcons();
    await refreshStagesCache();

    const startModule = can('insights', 'view') ? 'insights' : (MODULE_ORDER.find(m => can(m, 'view')) || null);
    if (startModule) {
      await switchModule(startModule);
    } else {
      document.getElementById('main-content').innerHTML = emptyState('lock', 'Sem módulos liberados', 'Fale com o Gestor/Admin para liberar o acesso a algum módulo.');
    }
    loadNotifications();
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  }

  function renderUserHeader() {
    document.getElementById('header-user-avatar').textContent = state.user.avatarInitials;
    document.getElementById('header-user-name').textContent = state.user.name;
    document.getElementById('header-user-role').textContent = state.user.role;
    const calBadge = document.getElementById('sidebar-cal-badge');
    if (state.user.isGestor) { calBadge.textContent = 'Geral / Equipe'; calBadge.style.color = 'var(--uc-cyan-accent)'; }
    else { calBadge.textContent = 'Privado'; calBadge.style.color = 'var(--accent-warning)'; }
  }

  function applySidebarPermissions() {
    document.querySelectorAll('.nav-link').forEach(link => {
      const mod = link.getAttribute('data-module');
      link.parentElement.style.display = can(mod, 'view') ? 'block' : 'none';
    });
    const adminGroup = document.getElementById('nav-group-admin');
    adminGroup.style.display = (can('integracoes', 'view') || can('configuracoes', 'view')) ? 'block' : 'none';
  }

  function emptyState(icon, title, desc) {
    return `<div class="empty-state"><i data-feather="${icon}"></i><h3>${esc(title)}</h3><p>${esc(desc)}</p></div>`;
  }

  /* ---------------------------- global UI bindings ---------------------------- */
  function bindGlobalUI() {
    const sidebar = document.getElementById('main-sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    document.getElementById('sidebar-toggle-btn').addEventListener('click', () => {
      if (window.innerWidth <= 1024) {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('visible');
      } else {
        sidebar.classList.toggle('collapsed');
      }
    });
    overlay.addEventListener('click', () => { sidebar.classList.remove('open'); overlay.classList.remove('visible'); });

    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        const mod = link.getAttribute('data-module');
        if (!can(mod, 'view')) return;
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        sidebar.classList.remove('open'); overlay.classList.remove('visible');
        await switchModule(mod);
      });
    });

    // Theme toggle
    document.getElementById('theme-toggle-btn').addEventListener('click', async () => {
      const next = state.user.theme === 'dark' ? 'light' : 'dark';
      state.user.theme = next;
      applyTheme(next);
      try { await api.patch('/auth/me/theme', { theme: next }); } catch { /* non-fatal */ }
    });

    // Notifications dropdown
    const notifBtn = document.getElementById('notification-btn');
    const notifDropdown = document.getElementById('notification-dropdown');
    function clearNotificationBadge() {
      document.getElementById('notification-count').textContent = '0';
      notifDropdown.querySelectorAll('.notification-item').forEach(i => i.classList.remove('unread'));
    }
    notifBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      notifDropdown.classList.toggle('hidden');
      if (!notifDropdown.classList.contains('hidden')) clearNotificationBadge();
    });
    document.getElementById('mark-notifications-read').addEventListener('click', clearNotificationBadge);

    // User menu dropdown
    const userMenuTrigger = document.getElementById('user-profile-menu');
    const userMenuDropdown = document.getElementById('user-menu-dropdown');
    userMenuTrigger.addEventListener('click', (e) => { e.stopPropagation(); userMenuDropdown.classList.toggle('hidden'); });
    document.addEventListener('click', () => {
      notifDropdown.classList.add('hidden');
      userMenuDropdown.classList.add('hidden');
    });

    document.getElementById('user-menu-logout').addEventListener('click', async () => {
      try { await api.post('/auth/logout'); } catch { /* ignore */ }
      location.href = '/login.html';
    });

    document.getElementById('user-menu-account').addEventListener('click', () => {
      userMenuDropdown.classList.add('hidden');
      openFormModal({
        title: 'Alterar minha senha',
        fields: [
          { name: 'currentPassword', label: 'Senha atual', type: 'password', required: true },
          { name: 'newPassword', label: 'Nova senha', type: 'password', required: true, hint: 'Mínimo 6 caracteres.' }
        ],
        submitLabel: 'Atualizar Senha',
        onSubmit: async (values) => {
          await api.post('/auth/me/password', values);
          showToast('Senha atualizada com sucesso.', 'success');
        }
      });
    });

    // Command palette
    const trigger = document.getElementById('global-search-trigger');
    const modal = document.getElementById('command-modal');
    trigger.addEventListener('click', () => openCommandPalette());
    modal.querySelector('.close-modal-btn').addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        modal.classList.contains('hidden') ? openCommandPalette() : modal.classList.add('hidden');
      }
      if (e.key === 'Escape') { modal.classList.add('hidden'); closeFormModal(); closeLeadPanel(); }
    });

    // Global delegated click handler for data-action elements
    document.addEventListener('click', handleGlobalAction);
  }

  async function openCommandPalette() {
    const modal = document.getElementById('command-modal');
    const body = document.getElementById('command-body');
    let leadsHtml = '';
    if (can('pipelines', 'view')) {
      try {
        const { leads } = await api.get('/leads');
        leadsHtml = leads.slice(0, 6).map(l => `
          <div class="command-item" data-action="open-lead" data-id="${l.id}"><i data-feather="user"></i> ${esc(l.name)} (${esc(l.courseInterest || 'curso não informado')})</div>
        `).join('');
      } catch { /* ignore */ }
    }
    body.innerHTML = `
      <div class="command-section">
        <h6>Módulos Rápidos</h6>
        ${MODULE_ORDER.filter(m => can(m, 'view')).map(m => `<div class="command-item" data-action="goto-module" data-id="${m}"><i data-feather="arrow-right-circle"></i> ${esc(moduleLabel(m))}</div>`).join('')}
      </div>
      ${leadsHtml ? `<div class="command-section"><h6>Leads Recentes</h6>${leadsHtml}</div>` : ''}
    `;
    modal.classList.remove('hidden');
    refreshIcons();
    document.getElementById('command-input').focus();
  }

  function moduleLabel(key) {
    const map = {
      insights: 'Dashboard', comunicacoes: 'Comunicações', pipelines: 'Jornada do Lead',
      calendario: 'Calendário Acadêmico', cursos: 'Cursos e Disciplinas', listas: 'Diretório e Listas',
      'agente-ia': 'Assistente Nexus AI', automacoes: 'Automações e Bots',
      relatorios: 'Central de Relatórios', integracoes: 'Hub de Integrações', configuracoes: 'Configurações e Permissões'
    };
    return map[key] || key;
  }

  async function loadNotifications() {
    const list = document.getElementById('notification-list');
    const countEl = document.getElementById('notification-count');
    const items = [];
    try {
      if (can('insights', 'view')) {
        const data = await api.get('/insights');
        const hot = data.byTemperature.find(t => t.key === 'quente');
        const cold = data.byTemperature.find(t => t.key === 'frio');
        if (hot && hot.count > 0) items.push({ icon: 'matricula', title: `${hot.count} lead(s) QUENTE aguardando contato`, desc: 'Classificados pela IA Nexus com alta chance de matrícula.' });
        if (cold && cold.count > 0) items.push({ icon: 'evasao', title: `${cold.count} lead(s) em risco (FRIO)`, desc: 'Baixo engajamento recente — considere reativação.' });
      }
    } catch { /* ignore */ }
    countEl.textContent = String(items.length);
    list.innerHTML = items.length ? items.map(i => `
      <div class="notification-item unread">
        <div class="notif-icon ${i.icon}"><i data-feather="${i.icon === 'evasao' ? 'alert-triangle' : 'check-circle'}"></i></div>
        <div class="notif-content"><p class="notif-title">${esc(i.title)}</p><p class="notif-desc">${esc(i.desc)}</p></div>
      </div>
    `).join('') : `<p style="font-size:0.8rem;color:var(--text-muted);text-align:center;padding:20px;">Nenhuma notificação no momento.</p>`;
    refreshIcons();
  }

  /* ---------------------------- router ---------------------------- */
  async function switchModule(key) {
    state.currentModule = key;
    const container = document.getElementById('main-content');
    container.innerHTML = `<div class="empty-state"><span class="loading-spinner"></span></div>`;
    try {
      switch (key) {
        case 'insights': await renderInsights(container); break;
        case 'comunicacoes': await renderComunicacoes(container); break;
        case 'pipelines': await renderPipelines(container); break;
        case 'calendario': await renderCalendario(container); break;
        case 'cursos': await renderCursos(container); break;
        case 'listas': await renderListas(container); break;
        case 'agente-ia': await renderAgenteIA(container); break;
        case 'automacoes': await renderAutomacoes(container); break;
        case 'relatorios': await renderRelatorios(container); break;
        case 'integracoes': await renderIntegracoes(container); break;
        case 'configuracoes': await renderConfiguracoes(container); break;
        default: container.innerHTML = emptyState('alert-circle', 'Módulo não encontrado', '');
      }
    } catch (err) {
      container.innerHTML = emptyState('alert-triangle', 'Erro ao carregar módulo', err.message || 'Tente novamente.');
      refreshIcons();
    }
  }

  /* ==========================================================================
     MODULE: INSIGHTS
     ========================================================================== */
  async function renderInsights(container) {
    const data = await api.get('/insights');
    const hot = data.byTemperature.find(t => t.key === 'quente') || { count: 0 };
    const cold = data.byTemperature.find(t => t.key === 'frio') || { count: 0 };

    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-group">
          <h2>Dashboard</h2>
          <p>Visão geral de desempenho acadêmico, captação e indicadores operacionais</p>
        </div>
        ${can('relatorios', 'export') ? `
        <div class="header-actions">
          <a class="btn btn-secondary" href="${api.downloadUrl('/reports/leads.csv')}"><i data-feather="download"></i> Exportar Alunos/Leads</a>
          <a class="btn btn-primary" href="${api.downloadUrl('/reports/courses.csv')}"><i data-feather="download"></i> Exportar Cursos</a>
        </div>` : ''}
      </div>

      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-header"><span class="kpi-title">Total de Leads / Alunos</span><div class="kpi-icon blue"><i data-feather="users"></i></div></div>
          <div class="kpi-value">${data.kpis.totalLeads}</div>
          <div class="kpi-trend neutral">Base monitorada em tempo real</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-header"><span class="kpi-title">Matrículas Efetivadas</span><div class="kpi-icon green"><i data-feather="user-plus"></i></div></div>
          <div class="kpi-value">${data.kpis.matriculados}</div>
          <div class="kpi-trend up"><i data-feather="trending-up"></i> ${data.kpis.taxaConversao}% de conversão</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-header"><span class="kpi-title">Leads Quentes (IA)</span><div class="kpi-icon red"><i data-feather="zap"></i></div></div>
          <div class="kpi-value">${hot.count}</div>
          <div class="kpi-trend up">Priorizar contato imediato</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-header"><span class="kpi-title">Alunos Ativos nos Cursos</span><div class="kpi-icon purple"><i data-feather="book-open"></i></div></div>
          <div class="kpi-value">${data.kpis.totalAlunosAtivos}</div>
          <div class="kpi-trend neutral">${data.kpis.totalCourses} cursos ativos</div>
        </div>
      </div>

      <div class="charts-grid">
        <div class="chart-card">
          <div class="chart-header"><h4>Distribuição por Etapa da Jornada do Lead</h4></div>
          <div class="canvas-wrapper"><canvas id="chartStages"></canvas></div>
        </div>
        <div class="chart-card">
          <div class="chart-header"><h4>Leads por Temperatura (IA)</h4></div>
          <div class="canvas-wrapper"><canvas id="chartTemps"></canvas></div>
        </div>
      </div>

      <div class="chart-card">
        <div class="chart-header"><h4>Origem dos Leads por Canal</h4></div>
        <div class="canvas-wrapper" style="height:220px;"><canvas id="chartChannels"></canvas></div>
      </div>
    `;

    const textColor = getComputedTextColor();
    new Chart(document.getElementById('chartStages'), {
      type: 'bar',
      data: { labels: data.byStage.map(s => s.label), datasets: [{ label: 'Leads', data: data.byStage.map(s => s.count), backgroundColor: data.byStage.map(s => s.color) }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: textColor, font: { size: 9 } } }, y: { ticks: { color: textColor } } } }
    });
    new Chart(document.getElementById('chartTemps'), {
      type: 'doughnut',
      data: { labels: data.byTemperature.map(t => t.label), datasets: [{ data: data.byTemperature.map(t => t.count), backgroundColor: data.byTemperature.map(t => t.color) }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: textColor } } } }
    });
    new Chart(document.getElementById('chartChannels'), {
      type: 'bar',
      data: { labels: data.byChannel.map(c => channelLabel(c.key)), datasets: [{ label: 'Leads', data: data.byChannel.map(c => c.count), backgroundColor: '#00A3E0' }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: textColor } }, y: { ticks: { color: textColor } } } }
    });
    refreshIcons();
  }

  function getComputedTextColor() {
    return getComputedStyle(document.documentElement).getPropertyValue('--text-sub').trim() || '#94A3B8';
  }

  /* ==========================================================================
     MODULE: COMUNICAÇÕES (Inbox do Chat, Contatos, Chat da Equipe)
     ========================================================================== */
  async function renderComunicacoes(container) {
    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-group">
          <h2>Central de Comunicações Omni-channel</h2>
          <p>WhatsApp, Instagram, Google, Site, listas de transmissão e chat interno da equipe</p>
        </div>
      </div>
      <div class="tabs-bar">
        <button class="tab-btn ${state.commsTab === 'inbox' ? 'active' : ''}" data-cm-tab="inbox"><i data-feather="inbox"></i> Inbox do Chat</button>
        <button class="tab-btn ${state.commsTab === 'contacts' ? 'active' : ''}" data-cm-tab="contacts"><i data-feather="users"></i> Contatos</button>
        <button class="tab-btn ${state.commsTab === 'team' ? 'active' : ''}" data-cm-tab="team"><i data-feather="briefcase"></i> Chat da Equipe</button>
      </div>
      <div id="comms-body"></div>
    `;
    container.querySelectorAll('[data-cm-tab]').forEach(btn => {
      btn.addEventListener('click', () => { state.commsTab = btn.getAttribute('data-cm-tab'); renderComunicacoes(container); });
    });
    refreshIcons();
    await renderCommsTabBody();
  }

  async function renderCommsTabBody() {
    const body = document.getElementById('comms-body');
    if (state.commsTab === 'inbox') return renderInboxDoChat(body);
    if (state.commsTab === 'contacts') return renderContactsSection(body);
    if (state.commsTab === 'team') return renderChatDaEquipe(body);
  }

  /* ---------- Inbox do Chat: conversas por canal + listas de transmissão ---------- */
  async function renderInboxDoChat(body) {
    const { leads } = await api.get('/leads');
    state.leadsCache = leads;

    body.innerHTML = `
      <div class="chat-layout">
        <div class="chat-threads-list">
          <div class="inbox-subtabs">
            <button class="inbox-subtab-btn ${state.inboxLeftView === 'conversas' ? 'active' : ''}" data-inbox-view="conversas"><i data-feather="message-square"></i> Conversas</button>
            ${can('segmentos', 'view') ? `<button class="inbox-subtab-btn ${state.inboxLeftView === 'transmissoes' ? 'active' : ''}" data-inbox-view="transmissoes"><i data-feather="send"></i> Listas de Transmissão</button>` : ''}
          </div>
          <div id="inbox-left-content"></div>
        </div>
        <div class="chat-main-panel" id="chat-main-panel"></div>
        <div class="chat-student-sidebar" id="chat-student-sidebar"></div>
      </div>
    `;
    body.querySelectorAll('[data-inbox-view]').forEach(btn => {
      btn.addEventListener('click', () => { state.inboxLeftView = btn.getAttribute('data-inbox-view'); renderInboxDoChat(body); });
    });

    if (state.inboxLeftView === 'transmissoes' && can('segmentos', 'view')) await renderBroadcastListsPanel();
    else await renderConversasList();
    refreshIcons();
  }

  async function renderConversasList() {
    const left = document.getElementById('inbox-left-content');
    const leads = state.leadsCache;
    const channels = ['todos', ...new Set(leads.map(l => l.sourceChannel))];
    const filtered = state.inboxChannelFilter === 'todos' ? leads : leads.filter(l => l.sourceChannel === state.inboxChannelFilter);
    const sorted = [...filtered].sort((a, b) => new Date(b.lastInteractionAt || 0) - new Date(a.lastInteractionAt || 0));
    if (!sorted.some(l => l.id === state.selectedThreadLeadId)) state.selectedThreadLeadId = sorted.length ? sorted[0].id : null;

    left.innerHTML = `
      <div class="channel-filter-pills">
        ${channels.map(c => `<button class="channel-pill ${state.inboxChannelFilter === c ? 'active' : ''}" data-channel-filter="${c}">${c === 'todos' ? 'Todos' : channelLabel(c)}</button>`).join('')}
      </div>
      <div class="threads-header"><input type="text" id="thread-filter" placeholder="Filtrar conversas..."></div>
      <div id="thread-items">${sorted.map(l => threadItemHtml(l)).join('') || `<p style="padding:20px;font-size:0.8rem;color:var(--text-muted)">Nenhuma conversa neste canal.</p>`}</div>
    `;

    left.querySelectorAll('[data-channel-filter]').forEach(btn => {
      btn.addEventListener('click', () => { state.inboxChannelFilter = btn.getAttribute('data-channel-filter'); state.selectedThreadLeadId = null; renderConversasList(); });
    });
    left.querySelector('#thread-filter').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      left.querySelectorAll('#thread-items .thread-item').forEach(item => {
        item.style.display = item.getAttribute('data-name').includes(q) ? 'flex' : 'none';
      });
    });
    left.querySelectorAll('#thread-items .thread-item').forEach(item => {
      item.addEventListener('click', () => {
        state.selectedThreadLeadId = Number(item.getAttribute('data-id'));
        left.querySelectorAll('#thread-items .thread-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        enterMobileChatView();
        loadConversation(state.selectedThreadLeadId);
      });
    });

    if (state.selectedThreadLeadId) await loadConversation(state.selectedThreadLeadId);
    else { document.getElementById('chat-main-panel').innerHTML = ''; document.getElementById('chat-student-sidebar').innerHTML = ''; }
    refreshIcons();
  }

  async function renderBroadcastListsPanel() {
    const left = document.getElementById('inbox-left-content');
    const { lists } = await api.get('/leads/broadcast-lists');

    left.innerHTML = `
      <div class="threads-header"><span style="font-size:0.78rem;color:var(--text-sub);font-weight:600;">Listas inteligentes geradas pela IA por segmento</span></div>
      <div id="broadcast-list-items">
        ${lists.map(l => `
          <div class="broadcast-list-item ${state.selectedBroadcastListId === l.id ? 'active' : ''}" data-broadcast-id="${l.id}">
            <div class="broadcast-list-icon" style="background:${l.color}22;color:${l.color}"><i data-feather="${l.icon}"></i></div>
            <div class="broadcast-list-details">
              <span class="broadcast-list-name">${esc(l.label)}</span>
              <span class="broadcast-list-count">${l.count} contato(s)</span>
            </div>
          </div>
        `).join('') || `<p style="padding:20px;font-size:0.8rem;color:var(--text-muted)">Nenhum segmento com contatos ainda.</p>`}
      </div>
    `;
    left.querySelectorAll('[data-broadcast-id]').forEach(item => {
      item.addEventListener('click', () => {
        const found = lists.find(l => l.id === item.getAttribute('data-broadcast-id'));
        left.querySelectorAll('[data-broadcast-id]').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        enterMobileChatView();
        loadBroadcastComposer(found);
      });
    });

    if (!lists.length) {
      document.getElementById('chat-main-panel').innerHTML = '';
      document.getElementById('chat-student-sidebar').innerHTML = '';
      refreshIcons();
      return;
    }
    const preselected = lists.find(l => l.id === state.selectedBroadcastListId) || lists[0];
    await loadBroadcastComposer(preselected);
    refreshIcons();
  }

  async function loadBroadcastComposer(list) {
    state.selectedBroadcastListId = list.id;
    const panel = document.getElementById('chat-main-panel');
    const sidebar = document.getElementById('chat-student-sidebar');
    const { broadcasts } = await api.get(`/leads/broadcasts?filterType=${encodeURIComponent(list.filterType)}&filterValue=${encodeURIComponent(list.filterValue)}`);

    panel.innerHTML = `
      ${chatBackButtonHtml()}
      <div class="chat-conversation-header">
        <div>
          <h5 style="font-size:0.95rem;font-weight:700;">${esc(list.label)}</h5>
          <span style="font-size:0.75rem;color:var(--uc-cyan-accent);">${list.count} contato(s) nesta lista de transmissão</span>
        </div>
      </div>
      <div class="chat-messages-container" id="broadcast-history">
        ${broadcasts.length ? broadcasts.map(b => `
          <div class="message-bubble outgoing">
            ${esc(b.message)}
            <div style="font-size:0.65rem;opacity:0.8;margin-top:6px;">Enviada por ${esc(b.authorName)} para ${b.reachedCount} contato(s) · ${fmtDateTime(b.createdAt)}</div>
          </div>
        `).join('') : `<p style="color:var(--text-muted);font-size:0.8rem;">Nenhuma transmissão enviada para esta lista ainda.</p>`}
      </div>
      ${can('segmentos', 'create') ? `
      <form class="chat-input-bar" id="broadcast-send-form">
        <input type="text" id="broadcast-send-input" placeholder="Mensagem para todos os contatos desta lista..." autocomplete="off">
        <button type="submit" class="btn btn-primary"><i data-feather="send"></i> Enviar Transmissão</button>
      </form>` : ''}
    `;
    const hist = document.getElementById('broadcast-history');
    hist.scrollTop = hist.scrollHeight;

    const form = document.getElementById('broadcast-send-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('broadcast-send-input');
        if (!input.value.trim()) return;
        try {
          const res = await api.post('/leads/broadcast', { filterType: list.filterType, filterValue: list.filterValue, message: input.value.trim() });
          input.value = '';
          showToast(`Transmissão enviada para ${res.reached} contato(s).`, 'success');
          await loadBroadcastComposer(list);
        } catch (err) { showToast(err.message, 'error'); }
      });
    }

    sidebar.innerHTML = `
      <div>
        <h6>Sobre esta lista</h6>
        <p style="font-size:0.8rem;line-height:1.5;">Lista inteligente gerada automaticamente pela IA Nexus a partir do segmento <b>${esc(list.label)}</b>. Ela é recalculada em tempo real conforme os leads mudam de segmento.</p>
      </div>
      <hr class="section-divider">
      <div><h6>Histórico</h6><p style="font-size:0.8rem;">${broadcasts.length} transmissão(ões) já enviada(s) para este segmento.</p></div>
    `;
    const backBtn = document.getElementById('chat-back-btn');
    if (backBtn) backBtn.addEventListener('click', () => renderInboxDoChat(document.getElementById('comms-body')));
    refreshIcons();
  }

  /* ---------- Contatos (Diretório de leads/alunos, também usado em Listas) ---------- */
  async function renderContactsSection(body) {
    const [{ leads }, { courses }] = await Promise.all([api.get('/leads'), state.coursesCache.length ? Promise.resolve({ courses: state.coursesCache }) : api.get('/courses')]);
    state.leadsCache = leads;
    state.coursesCache = courses;
    renderContactsTable(body, leads);
  }

  function renderContactsTable(body, leads) {
    const uniquePolos = [...new Set(leads.map(l => l.polo).filter(Boolean))].sort();
    const uniqueCourses = [...new Set(leads.map(l => l.courseInterest).filter(Boolean))].sort();

    body.innerHTML = `
      <div class="data-table-container">
        <div class="table-toolbar contacts-toolbar">
          <div class="contacts-filters">
            <input type="text" id="ct-filter-name" placeholder="Buscar por nome...">
            <select id="ct-filter-course"><option value="">Todos os cursos</option>${uniqueCourses.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
            <select id="ct-filter-polo"><option value="">Todos os polos</option>${uniquePolos.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select>
            <select id="ct-filter-stage"><option value="">Todas as etapas</option>${state.stagesCache.map(s => `<option value="${s.key}">${esc(s.label)}</option>`).join('')}</select>
            <select id="ct-filter-temp"><option value="">Todas as temperaturas</option>${TEMPERATURES.map(t => `<option value="${t.key}">${esc(t.label)}</option>`).join('')}</select>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            ${can('pipelines', 'create') ? `<button class="btn btn-secondary btn-sm" data-action="lead-new"><i data-feather="user-plus"></i> Adicionar</button>` : ''}
            ${can('pipelines', 'create') ? `<button class="btn btn-secondary btn-sm" id="ct-import-btn"><i data-feather="upload"></i> Importar Planilha</button>` : ''}
            <input type="file" id="ct-import-input" accept=".csv" style="display:none;">
            ${can('relatorios', 'export') ? `<a class="btn btn-primary btn-sm" href="${api.downloadUrl('/reports/leads.csv')}"><i data-feather="download"></i> Exportar Excel</a>` : ''}
          </div>
        </div>
        <div class="table-scroll">
          <table class="nexus-table">
            <thead><tr><th>Nome</th><th>Curso</th><th>Polo</th><th>Etapa</th><th>Temperatura</th><th></th></tr></thead>
            <tbody id="ct-table-body"></tbody>
          </table>
        </div>
      </div>
    `;

    function applyFilters() {
      const f = {
        name: document.getElementById('ct-filter-name').value.toLowerCase(),
        course: document.getElementById('ct-filter-course').value,
        polo: document.getElementById('ct-filter-polo').value,
        stage: document.getElementById('ct-filter-stage').value,
        temperature: document.getElementById('ct-filter-temp').value
      };
      const filtered = leads.filter(l =>
        (!f.name || (l.name || '').toLowerCase().includes(f.name)) &&
        (!f.course || l.courseInterest === f.course) &&
        (!f.polo || l.polo === f.polo) &&
        (!f.stage || l.stage === f.stage) &&
        (!f.temperature || l.temperature === f.temperature)
      );
      document.getElementById('ct-table-body').innerHTML = filtered.map(l => `
        <tr>
          <td><b>${esc(l.name)}</b> ${sourceIconHtml(l)}</td>
          <td>${esc(l.courseInterest || '—')}</td>
          <td>${esc(l.polo || '—')}</td>
          <td>${esc(stageLabel(l.stage))}</td>
          <td><span class="temp-badge ${l.temperature}">${esc(tempInfo(l.temperature).label)}</span></td>
          <td><i class="icon-action" data-feather="eye" data-action="open-lead" data-id="${l.id}"></i></td>
        </tr>
      `).join('') || '<tr><td colspan="7">Nenhum contato encontrado com esses filtros.</td></tr>';
      refreshIcons();
    }

    ['ct-filter-name', 'ct-filter-course', 'ct-filter-polo', 'ct-filter-stage', 'ct-filter-temp'].forEach(id => {
      document.getElementById(id).addEventListener(id === 'ct-filter-name' ? 'input' : 'change', applyFilters);
    });
    applyFilters();

    const importBtn = document.getElementById('ct-import-btn');
    if (importBtn) {
      const importInput = document.getElementById('ct-import-input');
      importBtn.addEventListener('click', () => importInput.click());
      importInput.addEventListener('change', async () => {
        const file = importInput.files[0];
        if (!file) return;
        const rows = parseCsv(await file.text());
        importInput.value = '';
        if (!rows.length) { showToast('Nenhum contato válido encontrado na planilha (coluna "Nome" é obrigatória).', 'error'); return; }
        try {
          const res = await api.post('/leads/import', { rows });
          showToast(`Importação concluída: ${res.created} contato(s) criado(s), ${res.skipped} ignorado(s).`, 'success');
          await switchModule(state.currentModule);
        } catch (err) { showToast(err.message, 'error'); }
      });
    }
    refreshIcons();
  }

  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length);
    if (!lines.length) return [];
    const delimiter = lines[0].includes(';') ? ';' : ',';
    const splitLine = (line) => {
      const result = [];
      let cur = '', inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { inQuotes = !inQuotes; continue; }
        if (ch === delimiter && !inQuotes) { result.push(cur); cur = ''; continue; }
        cur += ch;
      }
      result.push(cur);
      return result.map(s => s.trim());
    };
    const header = splitLine(lines[0]).map(h => h.toLowerCase());
    const idx = (label) => header.findIndex(h => h.includes(label));
    const iName = idx('nome'), iEmail = idx('email'), iPhone = idx('telefone'), iCourse = idx('curso'),
      iPolo = idx('polo'), iStage = idx('etapa'), iTemp = idx('temperatura'), iChannel = idx('canal'), iOrigin = idx('origem');
    if (iName === -1) return [];

    return lines.slice(1).map(line => {
      const cols = splitLine(line);
      return {
        name: cols[iName] || '',
        email: iEmail > -1 ? cols[iEmail] : '',
        phone: iPhone > -1 ? cols[iPhone] : '',
        courseInterest: iCourse > -1 ? cols[iCourse] : '',
        polo: iPolo > -1 ? cols[iPolo] : '',
        stage: iStage > -1 ? cols[iStage] : '',
        temperature: iTemp > -1 ? cols[iTemp] : '',
        sourceChannel: iChannel > -1 ? cols[iChannel] : '',
        sourceType: iOrigin > -1 ? cols[iOrigin] : ''
      };
    }).filter(r => r.name);
  }

  /* ---------- Chat da Equipe (grupos internos, gestão restrita ao Gestor) ---------- */
  async function renderChatDaEquipe(body) {
    const { groups } = await api.get('/teamchat/groups');

    body.innerHTML = `
      <div class="chat-layout">
        <div class="chat-threads-list">
          <div class="threads-header" style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:0.78rem;font-weight:700;">Grupos da Equipe</span>
            ${state.user.isGestor ? `<button class="btn btn-secondary btn-sm" data-action="team-group-new"><i data-feather="plus"></i></button>` : ''}
          </div>
          <div id="team-group-items">
            ${groups.map(g => `
              <div class="thread-item ${state.selectedTeamGroupId === g.id ? 'active' : ''}" data-group-id="${g.id}">
                <div class="thread-avatar" style="background:var(--accent-ai)"><i data-feather="users"></i></div>
                <div class="thread-details">
                  <div class="thread-top"><span>${esc(g.name)}</span></div>
                  <div class="thread-msg">${g.lastMessage ? esc(g.lastMessage) : `${g.members.length} membro(s)`}</div>
                </div>
              </div>
            `).join('') || `<p style="padding:20px;font-size:0.8rem;color:var(--text-muted)">Nenhum grupo ainda.${state.user.isGestor ? ' Crie o primeiro grupo da equipe.' : ' Peça ao Gestor para criar um grupo e te adicionar.'}</p>`}
          </div>
        </div>
        <div class="chat-main-panel" id="team-chat-panel"></div>
        <div class="chat-student-sidebar" id="team-chat-sidebar"></div>
      </div>
    `;
    body.querySelectorAll('[data-group-id]').forEach(item => {
      item.addEventListener('click', () => {
        const group = groups.find(g => g.id === Number(item.getAttribute('data-group-id')));
        body.querySelectorAll('[data-group-id]').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        enterMobileChatView();
        loadTeamGroup(group);
      });
    });

    const preselected = groups.find(g => g.id === state.selectedTeamGroupId) || groups[0];
    if (preselected) await loadTeamGroup(preselected);
    else { document.getElementById('team-chat-panel').innerHTML = ''; document.getElementById('team-chat-sidebar').innerHTML = ''; }
    refreshIcons();
  }

  async function loadTeamGroup(group) {
    state.selectedTeamGroupId = group.id;
    const { messages } = await api.get(`/teamchat/groups/${group.id}/messages`);
    const panel = document.getElementById('team-chat-panel');
    const sidebar = document.getElementById('team-chat-sidebar');

    panel.innerHTML = `
      ${chatBackButtonHtml()}
      <div class="chat-conversation-header">
        <div><h5 style="font-size:0.95rem;font-weight:700;">${esc(group.name)}</h5><span style="font-size:0.75rem;color:var(--uc-cyan-accent);">${group.members.length} membro(s)</span></div>
      </div>
      <div class="chat-messages-container" id="team-messages-container">
        ${messages.map(m => `
          <div class="message-bubble ${m.authorId === state.user.id ? 'outgoing' : 'incoming'}">
            ${m.authorId !== state.user.id ? `<div style="font-size:0.68rem;font-weight:700;opacity:0.8;margin-bottom:4px;">${esc(m.authorName || '')}</div>` : ''}
            ${esc(m.content)}
          </div>
        `).join('') || `<p style="color:var(--text-muted);font-size:0.8rem;">Nenhuma mensagem ainda. Diga oi para a equipe!</p>`}
      </div>
      <form class="chat-input-bar" id="team-send-form">
        <input type="text" id="team-send-input" placeholder="Mensagem para o grupo..." autocomplete="off">
        <button type="submit" class="btn btn-primary"><i data-feather="send"></i> Enviar</button>
      </form>
    `;
    const msgBox = document.getElementById('team-messages-container');
    msgBox.scrollTop = msgBox.scrollHeight;
    document.getElementById('team-send-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('team-send-input');
      if (!input.value.trim()) return;
      await api.post(`/teamchat/groups/${group.id}/messages`, { content: input.value.trim() });
      input.value = '';
      await loadTeamGroup(group);
    });

    sidebar.innerHTML = `
      <div>
        <h6>Membros do Grupo</h6>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px;">
          ${group.members.map(m => `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <div class="thread-avatar" style="width:28px;height:28px;font-size:0.68rem;">${esc(m.avatar_initials)}</div>
                <span style="font-size:0.8rem;">${esc(m.name)}</span>
              </div>
              ${state.user.isGestor ? `<i class="icon-action danger" data-feather="user-minus" data-action="team-group-remove-member" data-id="${group.id}" data-user-id="${m.id}"></i>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
      ${state.user.isGestor ? `<button class="btn btn-secondary btn-sm" data-action="team-group-add-member" data-id="${group.id}"><i data-feather="user-plus"></i> Adicionar Membro</button>` : ''}
    `;
    const backBtn = document.getElementById('chat-back-btn');
    if (backBtn) backBtn.addEventListener('click', () => renderChatDaEquipe(document.getElementById('comms-body')));
    refreshIcons();
  }

  async function openTeamGroupCreateModal() {
    const { users } = await api.get('/users');
    const others = users.filter(u => u.id !== state.user.id);
    openFormModal({
      title: 'Novo Grupo de Equipe',
      submitLabel: 'Criar Grupo',
      fields: [{ name: 'name', label: 'Nome do grupo', required: true, placeholder: 'Ex: Equipe Comercial Botucatu' }],
      extraHtml: `
        <div class="form-group">
          <label>Membros (você entra automaticamente)</label>
          <div style="display:flex;flex-direction:column;gap:6px;max-height:180px;overflow-y:auto;">
            ${others.map(u => `<div class="checkbox-row"><input type="checkbox" name="member-${u.id}" id="member-${u.id}"><label for="member-${u.id}">${esc(u.name)} (${esc(u.role)})</label></div>`).join('') || '<span class="form-hint">Nenhum outro usuário cadastrado ainda.</span>'}
          </div>
        </div>
      `,
      onSubmit: async (values, overlay) => {
        const memberUserIds = others.filter(u => overlay.querySelector(`[name="member-${u.id}"]`) && overlay.querySelector(`[name="member-${u.id}"]`).checked).map(u => u.id);
        await api.post('/teamchat/groups', { name: values.name, memberUserIds });
        showToast('Grupo criado.', 'success');
        await switchModule('comunicacoes');
      }
    });
  }

  async function openAddTeamMemberModal(groupId) {
    const [{ users }, { groups }] = await Promise.all([api.get('/users'), api.get('/teamchat/groups')]);
    const group = groups.find(g => g.id === groupId);
    const memberIds = new Set(group.members.map(m => m.id));
    const candidates = users.filter(u => !memberIds.has(u.id));
    if (!candidates.length) { showToast('Todos os usuários já fazem parte deste grupo.', 'info'); return; }
    openFormModal({
      title: `Adicionar Membro: ${group.name}`,
      submitLabel: 'Adicionar',
      fields: [{ name: 'userId', label: 'Usuário', type: 'select', options: candidates.map(u => ({ value: u.id, label: `${u.name} (${u.role})` })) }],
      onSubmit: async (values) => {
        await api.post(`/teamchat/groups/${groupId}/members`, { userId: Number(values.userId) });
        showToast('Membro adicionado ao grupo.', 'success');
        await switchModule('comunicacoes');
      }
    });
  }

  function threadItemHtml(l) {
    const initials = (l.name || '').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
    return `
      <div class="thread-item" data-id="${l.id}" data-name="${esc((l.name || '').toLowerCase())}">
        <div class="thread-avatar">${esc(initials)}</div>
        <div class="thread-details">
          <div class="thread-top"><span>${esc(l.name)} ${sourceIconHtml(l)}</span></div>
          <div class="thread-msg">${esc(l.courseInterest || 'Curso não informado')} · ${fmtRelative(l.lastInteractionAt)}</div>
        </div>
      </div>
    `;
  }

  async function loadConversation(leadId) {
    const { lead } = await api.get(`/leads/${leadId}`);
    const panel = document.getElementById('chat-main-panel');
    const sidebar = document.getElementById('chat-student-sidebar');
    const messages = lead.events.filter(e => e.type === 'message');

    panel.innerHTML = `
      ${chatBackButtonHtml()}
      <div class="chat-conversation-header">
        <div>
          <h5 style="font-size:0.95rem;font-weight:700;">${esc(lead.name)}</h5>
          <span style="font-size:0.75rem;color:var(--uc-cyan-accent);">${esc(lead.courseInterest || 'Curso não informado')} · ${esc(lead.polo || '')}</span>
        </div>
        <span class="temp-badge ${lead.temperature}">${esc(tempInfo(lead.temperature).label)}</span>
      </div>
      <div class="chat-messages-container" id="chat-messages-container">
        ${messages.map(m => `<div class="message-bubble ${m.direction === 'in' ? 'incoming' : 'outgoing'}">${esc(m.content)}</div>`).join('') || `<p style="color:var(--text-muted);font-size:0.8rem;">Sem mensagens ainda.</p>`}
      </div>
      ${can('comunicacoes', 'create') ? `
      <form class="chat-input-bar" id="chat-send-form">
        <input type="text" id="chat-send-input" placeholder="Digite sua resposta..." autocomplete="off">
        <button type="submit" class="btn btn-primary"><i data-feather="send"></i> Enviar</button>
      </form>` : ''}
    `;

    const msgContainer = document.getElementById('chat-messages-container');
    msgContainer.scrollTop = msgContainer.scrollHeight;

    const sendForm = document.getElementById('chat-send-form');
    if (sendForm) {
      sendForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('chat-send-input');
        if (!input.value.trim()) return;
        await api.post(`/leads/${leadId}/messages`, { content: input.value.trim(), direction: 'out', channel: lead.sourceChannel });
        input.value = '';
        await loadConversation(leadId);
      });
    }

    sidebar.innerHTML = `
      <div>
        <h6>Perfil do Candidato</h6>
        <p style="font-weight:700;font-size:0.85rem">${esc(lead.name)}</p>
        <p style="font-size:0.75rem;color:var(--text-sub)">${esc(lead.email || 'sem e-mail')}</p>
        <p style="font-size:0.75rem;color:var(--text-sub)">${esc(lead.phone || 'sem telefone')}</p>
      </div>
      <hr class="section-divider">
      <div>
        <h6>Situação (IA Nexus)</h6>
        <p style="font-size:0.78rem;line-height:1.5;">${esc(lead.ai.situacao)}</p>
      </div>
      <hr class="section-divider">
      <div>
        <h6>Jornada</h6>
        <p style="font-size:0.78rem">Etapa: <b>${esc(stageLabel(lead.stage))}</b></p>
        <p style="font-size:0.78rem">Responsável: <b>${esc(lead.ownerName || 'Não atribuído')}</b></p>
      </div>
      <button class="btn btn-secondary btn-sm" data-action="open-lead" data-id="${lead.id}"><i data-feather="external-link"></i> Ver perfil completo</button>
    `;
    const backBtn = document.getElementById('chat-back-btn');
    if (backBtn) backBtn.addEventListener('click', () => renderInboxDoChat(document.getElementById('comms-body')));
    refreshIcons();
  }

  /* ==========================================================================
     MODULE: PIPELINES (Jornada do Lead + Funil de Temperatura)
     ========================================================================== */
  async function renderPipelines(container) {
    const { leads } = await api.get('/leads');
    state.leadsCache = leads;
    await refreshStagesCache();

    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-group">
          <h2>Jornada do Lead</h2>
          <p>Arraste os cards para mover leads entre etapas ou reclassificar manualmente a temperatura</p>
        </div>
        <div class="header-actions">
          ${state.pipelinesTab === 'stage' && state.user.isGestor ? `<button class="btn btn-secondary" data-action="stage-manager-open"><i data-feather="sliders"></i> Gerenciar Etapas</button>` : ''}
          ${can('pipelines', 'create') ? `<button class="btn btn-primary" data-action="lead-new"><i data-feather="plus"></i> Novo Lead</button>` : ''}
        </div>
      </div>
      <div class="tabs-bar">
        <button class="tab-btn ${state.pipelinesTab === 'stage' ? 'active' : ''}" data-action="pipelines-tab" data-id="stage">Jornada do Lead</button>
        <button class="tab-btn ${state.pipelinesTab === 'temperature' ? 'active' : ''}" data-action="pipelines-tab" data-id="temperature">Funil por Temperatura (IA)</button>
      </div>
      <div class="kanban-board" id="kanban-board"></div>
    `;

    renderKanbanBoard();
    refreshIcons();
  }

  async function refreshStagesCache() {
    try { state.stagesCache = (await api.get('/stages')).stages; } catch { /* keep previous cache */ }
  }

  function openStageManagerModal() {
    openFormModal({
      title: 'Gerenciar Etapas da Jornada do Lead',
      submitLabel: 'Adicionar Etapa',
      fields: [
        { name: 'label', label: 'Nome da nova etapa', required: true, placeholder: 'Ex: Bolsa Aprovada' },
        { name: 'color', label: 'Cor', type: 'select', options: STAGE_COLOR_OPTIONS.map(c => ({ value: c, label: c })) }
      ],
      extraHtml: `<div class="form-hint" style="margin-bottom:8px;">As etapas abaixo já existem. Renomeie, mude a cor, reordene ou exclua (só é possível excluir uma etapa sem leads nela).</div><div id="stage-manager-list" class="stage-manager-list"></div>`,
      onSubmit: async (values, overlay) => {
        await api.post('/stages', values);
        await refreshStagesCache();
        showToast('Etapa criada.', 'success');
        renderStageManagerList();
        overlay.querySelector('[name="label"]').value = '';
        if (state.currentModule === 'pipelines') renderKanbanBoard();
        return 'keep-open';
      }
    });
    renderStageManagerList();
  }

  function renderStageManagerList() {
    const holder = document.getElementById('stage-manager-list');
    if (!holder) return;
    holder.innerHTML = state.stagesCache.map((s, idx) => `
      <div class="stage-manager-row">
        <span class="stage-color-dot" style="background:${s.color}"></span>
        <input type="text" class="stage-label-input" data-stage-id="${s.id}" value="${esc(s.label)}">
        <select class="stage-color-select" data-stage-id="${s.id}">
          ${STAGE_COLOR_OPTIONS.map(c => `<option value="${c}" ${c === s.color ? 'selected' : ''}>${c === s.color ? '● cor atual' : '●'}</option>`).join('')}
        </select>
        <div class="stage-row-actions">
          <i class="icon-action ${idx === 0 ? 'icon-action-disabled' : ''}" data-feather="arrow-up" data-action="stage-move-up" data-id="${s.id}"></i>
          <i class="icon-action ${idx === state.stagesCache.length - 1 ? 'icon-action-disabled' : ''}" data-feather="arrow-down" data-action="stage-move-down" data-id="${s.id}"></i>
          <i class="icon-action danger" data-feather="trash-2" data-action="stage-delete" data-id="${s.id}"></i>
        </div>
      </div>
    `).join('');

    holder.querySelectorAll('.stage-label-input').forEach(inp => {
      inp.addEventListener('change', async () => {
        try {
          await api.put(`/stages/${inp.getAttribute('data-stage-id')}`, { label: inp.value });
          await refreshStagesCache();
          showToast('Etapa renomeada.', 'success');
          if (state.currentModule === 'pipelines') renderKanbanBoard();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });
    holder.querySelectorAll('.stage-color-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        try {
          await api.put(`/stages/${sel.getAttribute('data-stage-id')}`, { color: sel.value });
          await refreshStagesCache();
          renderStageManagerList();
          if (state.currentModule === 'pipelines') renderKanbanBoard();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });
    refreshIcons();
  }

  function renderKanbanBoard() {
    const board = document.getElementById('kanban-board');
    const columns = state.pipelinesTab === 'stage' ? state.stagesCache : TEMPERATURES;
    const groupKey = state.pipelinesTab === 'stage' ? 'stage' : 'temperature';

    board.innerHTML = columns.map(col => {
      const items = state.leadsCache.filter(l => l[groupKey] === col.key);
      return `
        <div class="kanban-column" data-drop-zone="${col.key}">
          <div class="column-header">
            <div class="column-title-group"><span style="width:8px;height:8px;border-radius:50%;background:${col.color}"></span><h5>${esc(col.label)}</h5></div>
            <span class="col-count">${items.length}</span>
          </div>
          <div class="cards-container ${items.length ? '' : 'empty-hint'}">
            ${items.map(l => kanbanCardHtml(l)).join('')}
          </div>
        </div>
      `;
    }).join('');

    window.NexusDragDrop.init(board, async (leadIdStr, toKey) => {
      if (!can('pipelines', 'edit')) { showToast('Você não tem permissão para mover leads.', 'error'); return; }
      const payload = state.pipelinesTab === 'stage' ? { stage: toKey } : { temperature: toKey };
      try {
        await api.patch(`/leads/${leadIdStr}/move`, payload);
        await renderPipelines(document.getElementById('main-content'));
      } catch (err) { showToast(err.message, 'error'); }
    });

    board.querySelectorAll('.kanban-card').forEach(card => {
      card.addEventListener('click', () => openLeadPanel(Number(card.getAttribute('data-drag-id'))));
    });
    refreshIcons();
  }

  function kanbanCardHtml(l) {
    const temp = tempInfo(l.temperature);
    return `
      <div class="kanban-card" draggable="true" data-drag-id="${l.id}">
        <div class="kanban-card-top" style="justify-content:flex-end;">
          <span class="temp-badge ${l.temperature}">${esc(temp.label)}</span>
        </div>
        <span class="student-name">${esc(l.name)} ${sourceIconHtml(l)}</span>
        <span class="student-info">${esc(l.courseInterest || 'Curso não informado')}</span>
        <div class="card-footer">
          <span>${esc(l.polo || '—')}</span>
          <span>${fmtRelative(l.lastInteractionAt)}</span>
        </div>
      </div>
    `;
  }

  /* ---------------------------- lead slide-over panel ---------------------------- */
  async function openLeadPanel(leadId) {
    const overlay = document.getElementById('lead-panel-overlay');
    overlay.classList.remove('hidden');
    overlay.innerHTML = `<div class="lead-panel"><div class="empty-state"><span class="loading-spinner"></span></div></div>`;

    const { lead } = await api.get(`/leads/${leadId}`);
    const timelineHtml = [...lead.events].reverse().map(evt => `
      <div class="timeline-item ${evt.type}">
        <div class="timeline-dot"></div>
        <div class="timeline-content">
          <div class="timeline-text">${esc(evt.content)}</div>
          <div class="timeline-time">${fmtDateTime(evt.created_at)}${evt.direction ? ' · ' + (evt.direction === 'in' ? 'Recebida' : 'Enviada') : ''}</div>
        </div>
      </div>
    `).join('');

    overlay.innerHTML = `
      <div class="lead-panel">
        <div class="lead-panel-header">
          <div>
            <h3>${esc(lead.name)} ${sourceIconHtml(lead)}</h3>
            <div class="lead-meta">${esc(lead.courseInterest || 'Curso não informado')} · ${esc(lead.polo || '')}</div>
          </div>
          <span class="close-modal-btn" id="lead-panel-close" style="cursor:pointer;font-size:1.4rem;color:var(--text-muted)">&times;</span>
        </div>
        <div class="lead-panel-body">
          <div class="lead-panel-section">
            <h6>Dados do Lead</h6>
            <div class="lead-info-grid">
              <div><div class="label">E-mail</div><div class="value">${esc(lead.email || '—')}</div></div>
              <div><div class="label">Telefone</div><div class="value">${esc(lead.phone || '—')}</div></div>
              <div><div class="label">Etapa</div><div class="value">${esc(stageLabel(lead.stage))}</div></div>
              <div><div class="label">Temperatura</div><div class="value"><span class="temp-badge ${lead.temperature}">${esc(tempInfo(lead.temperature).label)}</span></div></div>
              <div><div class="label">Canal / Origem</div><div class="value">${channelLabel(lead.sourceChannel)} (${lead.sourceType === 'pago' ? 'Anúncio' : 'Orgânico'})</div></div>
              <div><div class="label">Responsável</div><div class="value">${esc(lead.ownerName || 'Não atribuído')}</div></div>
            </div>
          </div>

          <div class="lead-panel-section">
            <h6>Situação e Sugestão da IA Nexus</h6>
            <div class="ai-suggestion-box">
              <div class="situacao">${esc(lead.ai.situacao)}</div>
              <div class="mensagem">"${esc(lead.ai.mensagemSugerida)}"</div>
              <div class="abordagem"><i data-feather="target"></i> ${esc(lead.ai.abordagem)}</div>
            </div>
          </div>

          <div class="lead-panel-section">
            <h6>Linha do Tempo</h6>
            <div class="lead-timeline">${timelineHtml || '<p style="font-size:0.8rem;color:var(--text-muted)">Sem histórico.</p>'}</div>
          </div>
        </div>
        <div class="lead-panel-footer">
          ${can('pipelines', 'edit') ? `<button class="btn btn-ai btn-sm" data-action="lead-rescan" data-id="${lead.id}"><i data-feather="cpu"></i> Reclassificar com IA</button>` : ''}
          ${can('pipelines', 'edit') ? `<button class="btn btn-secondary btn-sm" data-action="lead-edit" data-id="${lead.id}"><i data-feather="edit-2"></i> Editar</button>` : ''}
          ${can('pipelines', 'delete') ? `<button class="btn btn-danger btn-sm" data-action="lead-delete" data-id="${lead.id}"><i data-feather="trash-2"></i> Excluir</button>` : ''}
        </div>
      </div>
    `;
    document.getElementById('lead-panel-close').addEventListener('click', closeLeadPanel);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeLeadPanel(); });
    refreshIcons();
  }

  function closeLeadPanel() {
    const overlay = document.getElementById('lead-panel-overlay');
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
  }

  function openLeadFormModal(existingLead) {
    const courseOptions = state.coursesCache.map(c => ({ value: c.name, label: c.name }));
    if (!courseOptions.length) courseOptions.push({ value: '', label: 'Nenhum curso cadastrado' });
    openFormModal({
      title: existingLead ? 'Editar Lead' : 'Novo Lead',
      submitLabel: existingLead ? 'Salvar Alterações' : 'Cadastrar Lead',
      fields: [
        { name: 'name', label: 'Nome completo', required: true, value: existingLead && existingLead.name },
        { name: 'email', label: 'E-mail', type: 'email', value: existingLead && existingLead.email },
        { name: 'phone', label: 'Telefone', value: existingLead && existingLead.phone },
        { name: 'courseInterest', label: 'Curso de interesse', type: 'select', options: courseOptions, value: existingLead && existingLead.courseInterest },
        { name: 'polo', label: 'Polo', value: existingLead && existingLead.polo, placeholder: 'Ex: Botucatu - SP' },
        ...(existingLead ? [] : [
          { name: 'sourceChannel', label: 'Canal de origem', type: 'select', options: Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label })) },
          { name: 'sourceType', label: 'Tipo de origem', type: 'select', options: [{ value: 'organico', label: 'Orgânico' }, { value: 'pago', label: 'Anúncio Pago' }] }
        ])
      ],
      onSubmit: async (values) => {
        if (existingLead) {
          await api.put(`/leads/${existingLead.id}`, values);
          showToast('Lead atualizado.', 'success');
          await openLeadPanel(existingLead.id);
        } else {
          await api.post('/leads', values);
          showToast('Lead cadastrado.', 'success');
        }
        if (state.currentModule === 'pipelines') await switchModule('pipelines');
      }
    });
  }

  /* ==========================================================================
     MODULE: CALENDÁRIO (Hoje / Agenda Completa + compartilhamento)
     ========================================================================== */
  function isToday(iso) {
    if (!iso) return false;
    const d = new Date(iso);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }

  async function renderCalendario(container) {
    if (!state.calendarTab) state.calendarTab = 'hoje';
    let members = [];
    try { members = (await api.get('/calendar/team-members')).members; } catch { /* ignore */ }
    state.calendarMembersCache = members;

    const filterValue = container.dataset.calFilter || 'all';
    const { events } = await api.get(`/calendar${state.user.isGestor ? '?ownerUserId=' + filterValue : ''}`);
    state.calendarEventsCache = events;

    const todayEvents = events.filter(evt => isToday(evt.startsAt) && (state.user.isGestor || evt.isOwner));

    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-group">
          <h2>Calendário Acadêmico ${state.user.isGestor ? '(Visão do Gestor)' : '(Agenda Privada)'}</h2>
          <p>${state.user.isGestor ? 'Visualize os compromissos de toda a equipe ou filtre por colaborador' : 'Seus compromissos privados — outros colaboradores só veem o que você compartilhar'}</p>
        </div>
        <div class="header-actions">
          ${state.calendarTab === 'agenda' && state.user.isGestor ? `
            <select class="btn btn-secondary" id="cal-filter-select">
              <option value="all" ${filterValue === 'all' ? 'selected' : ''}>Todos os Colaboradores</option>
              ${members.map(m => `<option value="${m.id}" ${String(filterValue) === String(m.id) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
            </select>` : ''}
          ${can('calendario', 'create') ? `<button class="btn btn-primary" data-action="event-new"><i data-feather="plus"></i> Novo Evento</button>` : ''}
        </div>
      </div>
      <div class="tabs-bar">
        <button class="tab-btn ${state.calendarTab === 'hoje' ? 'active' : ''}" data-cal-tab="hoje">Hoje</button>
        <button class="tab-btn ${state.calendarTab === 'agenda' ? 'active' : ''}" data-cal-tab="agenda">Agenda Completa</button>
      </div>
      <div class="chart-card">
        <div class="chart-header"><h4>${state.calendarTab === 'hoje' ? 'Compromissos de Hoje' : 'Próximos Compromissos'}</h4></div>
        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap:14px;">
          ${(state.calendarTab === 'hoje' ? todayEvents : events).length
            ? (state.calendarTab === 'hoje' ? todayEvents : events).map(evt => calendarCardHtml(evt)).join('')
            : `<p style="font-size:0.82rem;color:var(--text-muted)">${state.calendarTab === 'hoje' ? 'Nenhum compromisso seu para hoje.' : 'Nenhum evento agendado.'}</p>`}
        </div>
      </div>
    `;

    container.querySelectorAll('[data-cal-tab]').forEach(btn => {
      btn.addEventListener('click', () => { state.calendarTab = btn.getAttribute('data-cal-tab'); renderCalendario(container); });
    });

    const filterSelect = document.getElementById('cal-filter-select');
    if (filterSelect) {
      filterSelect.addEventListener('change', () => {
        container.dataset.calFilter = filterSelect.value;
        renderCalendario(container);
      });
    }
    refreshIcons();
  }

  function calendarCardHtml(evt) {
    const canManage = evt.isOwner || state.user.isGestor;
    return `
      <div style="background:var(--bg-app); border:1px solid var(--border-color); border-radius:10px; padding:14px; display:flex; flex-direction:column; gap:8px;">
        <span style="font-size:0.7rem; font-weight:700; color:var(--uc-cyan-accent)">${fmtDateTime(evt.startsAt)}</span>
        <span style="font-weight:700; font-size:0.85rem">${esc(evt.title)}</span>
        <span style="font-size:0.72rem; color:var(--text-sub)">Tipo: ${esc(evt.type)} ${evt.ownerName ? '· ' + esc(evt.ownerName) : ''}</span>
        ${evt.isPrivate ? '<span style="font-size:0.65rem; color:var(--accent-warning); font-weight:700">🔒 Privado</span>' : ''}
        ${!evt.isOwner ? `<span style="font-size:0.65rem; color:var(--accent-ai); font-weight:700">🔗 Compartilhado por ${esc(evt.ownerName || '')}</span>` : ''}
        ${evt.isOwner && evt.sharedWith && evt.sharedWith.length ? `<span style="font-size:0.65rem; color:var(--text-muted);">Compartilhado com: ${evt.sharedWith.map(s => esc(s.name)).join(', ')}</span>` : ''}
        ${canManage ? `
        <div style="display:flex; gap:10px; margin-top:4px;">
          ${can('calendario', 'edit') ? `<i class="icon-action" data-feather="edit-2" data-action="event-edit" data-id="${evt.id}"></i>` : ''}
          ${can('calendario', 'delete') ? `<i class="icon-action danger" data-feather="trash-2" data-action="event-delete" data-id="${evt.id}"></i>` : ''}
        </div>` : ''}
      </div>
    `;
  }

  function toDatetimeLocal(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function openEventFormModal(existingEvent) {
    let members = state.calendarMembersCache;
    if (!members) {
      try { members = (await api.get('/calendar/team-members')).members; } catch { members = []; }
    }
    const alreadySharedIds = new Set((existingEvent && existingEvent.sharedWith || []).map(s => s.id));

    openFormModal({
      title: existingEvent ? 'Editar Evento' : 'Novo Evento Acadêmico',
      submitLabel: existingEvent ? 'Salvar Alterações' : 'Criar Evento',
      fields: [
        { name: 'title', label: 'Título', required: true, value: existingEvent && existingEvent.title },
        { name: 'type', label: 'Tipo', type: 'select', value: existingEvent && existingEvent.type, options: ['Atendimento', 'Aula', 'Vestibular', 'Gestão', 'Reunião', 'Lembrete'].map(v => ({ value: v, label: v })) },
        { name: 'startsAt', label: 'Data e Hora', type: 'datetime-local', required: true, value: existingEvent ? toDatetimeLocal(existingEvent.startsAt) : '' },
        { name: 'isPrivate', label: 'Evento privado (apenas eu e o Gestor podem ver)', type: 'checkbox', value: existingEvent ? existingEvent.isPrivate : true }
      ],
      extraHtml: members.length ? `
        <div class="form-group">
          <label><i data-feather="share-2" style="width:14px;height:14px;vertical-align:-2px;"></i> Compartilhar com</label>
          <span class="form-hint">Marque quem mais pode ver este compromisso. O Gestor/Admin sempre vê tudo.</span>
          <div style="display:flex;flex-direction:column;gap:6px;max-height:160px;overflow-y:auto;margin-top:6px;">
            ${members.map(m => `<div class="checkbox-row"><input type="checkbox" name="share-${m.id}" id="share-${m.id}" ${alreadySharedIds.has(m.id) ? 'checked' : ''}><label for="share-${m.id}">${esc(m.name)}</label></div>`).join('')}
          </div>
        </div>
      ` : '',
      onSubmit: async (values, overlay) => {
        const sharedWithUserIds = members.filter(m => overlay.querySelector(`[name="share-${m.id}"]`) && overlay.querySelector(`[name="share-${m.id}"]`).checked).map(m => m.id);
        const payload = { title: values.title, type: values.type, startsAt: new Date(values.startsAt).toISOString(), isPrivate: !!values.isPrivate, sharedWithUserIds };
        if (existingEvent) await api.put(`/calendar/${existingEvent.id}`, payload);
        else await api.post('/calendar', payload);
        showToast(existingEvent ? 'Evento atualizado.' : 'Evento criado.', 'success');
        await switchModule('calendario');
      }
    });
    refreshIcons();
  }

  /* ==========================================================================
     MODULE: CURSOS
     ========================================================================== */
  async function renderCursos(container) {
    const { courses } = await api.get('/courses');
    state.coursesCache = courses;

    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-group">
          <h2>Catálogo de Cursos e Ofertas Acadêmicas</h2>
          <p>Graduações EAD, Semipresenciais e Pós-Graduação</p>
        </div>
        ${can('cursos', 'create') ? `<button class="btn btn-primary" data-action="course-new"><i data-feather="plus"></i> Cadastrar Curso</button>` : ''}
      </div>
      <div class="card-list-grid">
        ${courses.map(c => `
          <div class="kpi-card">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span class="student-tag ead">${esc(c.modalidade)}</span>
              <span style="font-size:0.75rem; font-weight:700; color:var(--accent-success)">${esc(c.status)}</span>
            </div>
            <h4 style="font-size:1.1rem; font-weight:800; font-family:var(--font-heading);">${esc(c.name)}</h4>
            <p style="font-size:0.8rem; color:var(--text-sub)">Carga Horária: ${esc(c.cargaHoraria || '—')}</p>
            ${c.promotionalPrice ? `
              <p style="font-size:0.8rem; color:var(--text-muted); text-decoration:line-through;">De: ${esc(c.mensalidade || '—')}</p>
              <p style="font-size:0.85rem;">Por: <span class="promo-price-badge">${esc(c.promotionalPrice)}</span></p>
            ` : `<p style="font-size:0.8rem; color:var(--text-sub)">Mensalidade: <b>${esc(c.mensalidade || '—')}</b></p>`}
            <p style="font-size:0.78rem; color:var(--text-muted)">Coordenador: ${esc(c.coordenador || '—')}</p>
            <div style="border-top:1px solid var(--border-color); padding-top:10px; display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:0.75rem; font-weight:700; color:var(--uc-cyan-accent)">${c.alunosAtivos} Alunos Ativos</span>
              <div style="display:flex; gap:10px;">
                ${can('cursos', 'edit') ? `<i class="icon-action" data-feather="edit-2" data-action="course-edit" data-id="${c.id}"></i>` : ''}
                ${can('cursos', 'delete') ? `<i class="icon-action danger" data-feather="trash-2" data-action="course-delete" data-id="${c.id}"></i>` : ''}
              </div>
            </div>
          </div>
        `).join('') || emptyState('book-open', 'Nenhum curso cadastrado', 'Cadastre o primeiro curso da instituição.')}
      </div>
    `;
    refreshIcons();
  }

  function openCourseFormModal(existingCourse) {
    const fields = [
      { name: 'name', label: 'Nome do curso', required: true, value: existingCourse && existingCourse.name },
      { name: 'modalidade', label: 'Modalidade', type: 'select', value: existingCourse && existingCourse.modalidade, options: ['EAD', 'Semipresencial', 'Presencial', 'EAD (Pós)'].map(v => ({ value: v, label: v })) },
      { name: 'mensalidade', label: 'Mensalidade', value: existingCourse && existingCourse.mensalidade, placeholder: 'R$ 000,00' }
    ];
    if (state.user.isGestor) {
      fields.push({ name: 'promotionalPrice', label: 'Valor Promocional (opcional, somente Gestor/Admin)', value: existingCourse && existingCourse.promotionalPrice, placeholder: 'Ex: R$ 290,00' });
    }
    fields.push(
      { name: 'cargaHoraria', label: 'Carga Horária', value: existingCourse && existingCourse.cargaHoraria, placeholder: 'Ex: 3.600h' },
      { name: 'coordenador', label: 'Coordenador', value: existingCourse && existingCourse.coordenador },
      { name: 'status', label: 'Status', type: 'select', value: (existingCourse && existingCourse.status) || 'Ativo', options: [{ value: 'Ativo', label: 'Ativo' }, { value: 'Inativo', label: 'Inativo' }] }
    );

    openFormModal({
      title: existingCourse ? 'Editar Curso' : 'Cadastrar Curso',
      submitLabel: existingCourse ? 'Salvar Alterações' : 'Cadastrar',
      fields,
      onSubmit: async (values) => {
        if (existingCourse) await api.put(`/courses/${existingCourse.id}`, values);
        else await api.post('/courses', values);
        showToast(existingCourse ? 'Curso atualizado.' : 'Curso cadastrado.', 'success');
        await switchModule('cursos');
      }
    });
  }

  /* ==========================================================================
     MODULE: LISTAS (Diretório Acadêmico)
     ========================================================================== */
  async function renderListas(container) {
    const { leads } = await api.get('/leads');
    const courses = state.coursesCache.length ? state.coursesCache : (await api.get('/courses')).courses;
    state.coursesCache = courses;
    const staff = [...new Set(courses.map(c => c.coordenador).filter(Boolean))];

    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-group">
          <h2>Diretório Acadêmico e Listas Enterprise</h2>
          <p>Busque por nome, curso, polo, etapa ou temperatura — alunos, candidatos e corpo docente</p>
        </div>
      </div>
      <div class="tabs-bar">
        <button class="tab-btn active" data-listas-tab="alunos">Alunos e Candidatos</button>
        <button class="tab-btn" data-listas-tab="docentes">Corpo Docente</button>
      </div>
      <div id="listas-body"></div>
    `;

    function renderDocentes() {
      document.getElementById('listas-body').innerHTML = `
        <div class="data-table-container">
          <div class="table-toolbar"><span class="text-sub" style="font-size:0.8rem">Lista informativa derivada dos cursos cadastrados</span></div>
          <div class="table-scroll">
            <table class="nexus-table">
              <thead><tr><th>Coordenador / Docente</th><th>Curso(s)</th></tr></thead>
              <tbody>
                ${staff.map(s => `<tr><td><b>${esc(s)}</b></td><td>${courses.filter(c => c.coordenador === s).map(c => esc(c.name)).join(', ')}</td></tr>`).join('') || '<tr><td colspan="2">Nenhum coordenador cadastrado.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    container.querySelectorAll('[data-listas-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('[data-listas-tab]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        btn.getAttribute('data-listas-tab') === 'alunos' ? renderContactsTable(document.getElementById('listas-body'), leads) : renderDocentes();
      });
    });

    renderContactsTable(document.getElementById('listas-body'), leads);
  }

  /* ==========================================================================
     MODULE: AGENTE DE IA
     ========================================================================== */
  async function renderAgenteIA(container) {
    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-group">
          <h2>Assistente Acadêmico Nexus AI <span class="nav-badge ai-sparkle">IA</span></h2>
          <p>Motor de regras determinístico sobre dados reais — sem chamadas a APIs externas de IA</p>
        </div>
      </div>
      <div class="ai-console-wrapper">
        <div class="ai-chat-window">
          <div class="ai-chat-messages" id="ai-messages-list">
            <div class="message-bubble incoming" style="background:rgba(139,92,246,0.1); border-color:rgba(139,92,246,0.3)">
              🤖 <b>Nexus AI:</b> Olá! Posso analisar risco de evasão, gerar comunicados institucionais e consultar métricas de conversão em tempo real. O que você precisa?
            </div>
          </div>
          <form class="chat-input-bar" id="ai-send-form">
            <input type="text" id="ai-input-field" placeholder="Pergunte ao Nexus AI..." autocomplete="off">
            <button type="submit" class="btn btn-ai"><i data-feather="zap"></i> Executar</button>
          </form>
        </div>
        <div class="ai-prompt-shortcuts">
          <h6>Comandos Rápidos</h6>
          <button class="prompt-btn" data-action="ai-quick" data-id="Analisar risco de evasão na base atual"><i data-feather="alert-circle" style="color:var(--accent-danger)"></i> Analisar Risco de Evasão</button>
          <button class="prompt-btn" data-action="ai-quick" data-id="Gerar comunicado institucional de rematrícula"><i data-feather="file-text" style="color:var(--uc-cyan-accent)"></i> Redigir Comunicado de Rematrícula</button>
          <button class="prompt-btn" data-action="ai-quick" data-id="Consultar taxa de conversão do vestibular"><i data-feather="pie-chart" style="color:var(--accent-success)"></i> Métrica de Conversão do Vestibular</button>
          <button class="prompt-btn" data-action="ai-quick" data-id="Quantos leads quentes existem agora"><i data-feather="zap" style="color:var(--accent-warning)"></i> Leads Quentes Agora</button>
        </div>
      </div>
    `;
    document.getElementById('ai-send-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('ai-input-field');
      if (!input.value.trim()) return;
      sendAiPrompt(input.value.trim());
      input.value = '';
    });
    refreshIcons();
  }

  async function sendAiPrompt(promptText) {
    const list = document.getElementById('ai-messages-list');
    if (!list) return;
    const userMsg = document.createElement('div');
    userMsg.className = 'message-bubble outgoing';
    userMsg.textContent = promptText;
    list.appendChild(userMsg);
    list.scrollTop = list.scrollHeight;

    try {
      const { reply } = await api.post('/insights/ask', { prompt: promptText });
      const aiMsg = document.createElement('div');
      aiMsg.className = 'message-bubble incoming';
      aiMsg.style.background = 'rgba(139,92,246,0.1)';
      aiMsg.style.borderColor = 'rgba(139,92,246,0.3)';
      aiMsg.innerHTML = `🤖 <b>Nexus AI:</b> ${esc(reply)}`;
      list.appendChild(aiMsg);
      list.scrollTop = list.scrollHeight;
    } catch (err) { showToast(err.message, 'error'); }
  }

  /* ==========================================================================
     MODULE: AUTOMAÇÕES (bots + galeria de modelos, estilo Kommo)
     ========================================================================== */
  const AUTOMATION_CHANNEL_LABELS = { whatsapp: 'WhatsApp', email: 'E-mail', sms: 'SMS', push: 'Notificação Push' };
  const AUTOMATION_TEMPLATES = [
    {
      key: 'recuperacao', name: 'Recuperação de Leads Abandonados', triggerDesc: 'Sem resposta há 3 dias',
      description: 'Reengaja automaticamente leads que pararam de responder no meio da conversa.',
      icon: 'rotate-ccw', channel: 'whatsapp', sendTime: '10:00',
      preview: 'Oi! Vi que você tinha interesse em um dos nossos cursos 👋 Ainda posso te ajudar com alguma dúvida?'
    },
    {
      key: 'boasvindas', name: 'Boas-Vindas e Acesso ao AVA', triggerDesc: 'Pagamento da 1ª mensalidade confirmado',
      description: 'Envia as credenciais de acesso ao Ambiente Virtual de Aprendizagem assim que a matrícula é efetivada.',
      icon: 'user-check', channel: 'email', sendTime: '08:00',
      preview: 'Parabéns pela matrícula 🎓 Seu acesso ao Portal AVA já está liberado. Bons estudos!'
    },
    {
      key: 'vestibular', name: 'Lembrete de Vestibular Online', triggerDesc: 'D-1 antes da aplicação da prova',
      description: 'Lembra os candidatos inscritos sobre data, horário e link da prova do vestibular.',
      icon: 'calendar', channel: 'whatsapp', sendTime: '18:00',
      preview: 'Lembrete: seu vestibular online é amanhã às 9h. Boa sorte na prova! 🍀'
    },
    {
      key: 'frequencia', name: 'Alerta de Frequência Mínima', triggerDesc: 'Frequência no AVA abaixo de 75%',
      description: 'Notifica a tutoria quando um aluno ativo cai abaixo da frequência mínima exigida.',
      icon: 'alert-triangle', channel: 'email', sendTime: '07:00',
      preview: 'Alerta interno: o aluno está com frequência abaixo de 75% este mês. Sugerido contato da tutoria.'
    },
    {
      key: 'nutricao', name: 'Nutrição de Leads Frios (IA)', triggerDesc: 'Lead classificado como FRIO pela IA Nexus',
      description: 'Inclui automaticamente leads frios em uma régua de conteúdo para reaquecer o interesse.',
      icon: 'thermometer', channel: 'whatsapp', sendTime: '15:00',
      preview: 'Ainda dá tempo! Preparamos condições especiais para quem se matricular esta semana 🎯'
    }
  ];

  async function renderAutomacoes(container) {
    const { automations } = await api.get('/automations');
    state.automationsCache = automations;
    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-group">
          <h2>Motor de Automações e Bots Acadêmicos</h2>
          <p>Ative modelos prontos com um clique ou gerencie suas automações ativas</p>
        </div>
        ${can('automacoes', 'create') ? `<button class="btn btn-primary" data-action="automation-new"><i data-feather="zap"></i> Nova Automação em Branco</button>` : ''}
      </div>

      <div class="chart-card">
        <div class="chart-header"><h4>Automações Ativas</h4></div>
        <div class="table-scroll">
          <table class="nexus-table">
            <thead><tr><th>Nome</th><th>Gatilho</th><th>Canal</th><th>Horário</th><th>Status</th><th>Execuções</th><th>Ações</th></tr></thead>
            <tbody>
              ${automations.map(a => `
                <tr>
                  <td><b>${esc(a.name)}</b><br><span class="text-sub" style="font-size:0.72rem;">${esc(a.description || '')}</span></td>
                  <td style="font-size:0.78rem;">${esc(a.triggerDesc || '—')}</td>
                  <td style="font-size:0.78rem;">${esc(AUTOMATION_CHANNEL_LABELS[a.channel] || a.channel || '—')}</td>
                  <td style="font-size:0.78rem;"><i data-feather="clock" style="width:12px;height:12px;vertical-align:-2px;"></i> ${esc(a.sendTime || '—')}</td>
                  <td>
                    ${can('automacoes', 'edit') ? `
                      <label class="switch" title="${a.active ? 'Desativar' : 'Ativar'}">
                        <input type="checkbox" data-action="automation-toggle" data-id="${a.id}" ${a.active ? 'checked' : ''}>
                        <span class="switch-slider"></span>
                      </label>
                    ` : `<span style="color:${a.active ? 'var(--accent-success)' : 'var(--text-muted)'}; font-weight:700; font-size:0.78rem;">${a.active ? 'Ativo' : 'Inativo'}</span>`}
                  </td>
                  <td style="font-size:0.78rem;">${a.runCount}x<br><span class="text-sub" style="font-size:0.68rem;">${a.lastRunAt ? fmtRelative(a.lastRunAt) : 'nunca'}</span></td>
                  <td class="row-actions">
                    ${can('automacoes', 'edit') ? `<button class="btn btn-secondary btn-sm" data-action="automation-run" data-id="${a.id}" ${a.active ? '' : 'disabled'}>Executar agora</button>` : ''}
                    ${can('automacoes', 'edit') ? `<button class="btn btn-secondary btn-sm" data-action="automation-test-send" data-id="${a.id}"><i data-feather="send"></i> Testar Envio</button>` : ''}
                    ${can('automacoes', 'edit') ? `<i class="icon-action" data-feather="edit-2" data-action="automation-edit" data-id="${a.id}"></i>` : ''}
                    ${can('automacoes', 'delete') ? `<i class="icon-action danger" data-feather="trash-2" data-action="automation-delete" data-id="${a.id}"></i>` : ''}
                  </td>
                </tr>
              `).join('') || '<tr><td colspan="7">Nenhuma automação ativa ainda — adicione um modelo abaixo.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="chart-card">
        <div class="chart-header"><h4>Modelos de Automação</h4><span class="text-sub" style="font-size:0.8rem">Clique em "Adicionar" para ativar um fluxo pronto</span></div>
        <div class="automation-template-grid">
          ${AUTOMATION_TEMPLATES.map(t => `
            <div class="automation-template-card">
              <div class="automation-template-header">
                <div class="automation-template-icon"><i data-feather="${t.icon}"></i></div>
                <span class="automation-template-trigger">${esc(t.triggerDesc)}</span>
              </div>
              <h5>${esc(t.name)}</h5>
              <p class="automation-template-desc">${esc(t.description)}</p>
              <div class="automation-template-chat-preview">
                <div class="message-bubble incoming" style="max-width:100%;">${esc(t.preview)}</div>
              </div>
              ${can('automacoes', 'create') ? `<button class="btn btn-secondary btn-sm btn-block" data-action="automation-template-add" data-id="${t.key}"><i data-feather="plus"></i> Adicionar</button>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
    refreshIcons();
  }

  function openAutomationFormModal(existingAutomation) {
    openFormModal({
      title: existingAutomation ? 'Editar Automação' : 'Criar Automação',
      submitLabel: existingAutomation ? 'Salvar Alterações' : 'Criar',
      fields: [
        { name: 'name', label: 'Nome', required: true, value: existingAutomation && existingAutomation.name },
        { name: 'description', label: 'Descrição', type: 'textarea', value: existingAutomation && existingAutomation.description },
        { name: 'triggerDesc', label: 'Gatilho', placeholder: 'Ex: D-3 antes do vencimento', value: existingAutomation && existingAutomation.triggerDesc },
        { name: 'channel', label: 'Canal de Envio', type: 'select', value: (existingAutomation && existingAutomation.channel) || 'whatsapp', options: Object.entries(AUTOMATION_CHANNEL_LABELS).map(([value, label]) => ({ value, label })) },
        { name: 'sendTime', label: 'Horário de Disparo', type: 'time', value: (existingAutomation && existingAutomation.sendTime) || '09:00' },
        { name: 'message', label: 'Mensagem a Enviar', type: 'textarea', value: existingAutomation && existingAutomation.message, placeholder: 'Ex: Olá {{nome}}, seu boleto do curso {{curso}} vence em breve...', hint: 'Use {{nome}} e {{curso}} para personalizar automaticamente.' }
      ],
      onSubmit: async (values) => {
        if (existingAutomation) await api.put(`/automations/${existingAutomation.id}`, values);
        else await api.post('/automations', values);
        showToast(existingAutomation ? 'Automação atualizada.' : 'Automação criada.', 'success');
        await switchModule('automacoes');
      }
    });
  }

  async function testSendAutomation(id) {
    try {
      const res = await api.post(`/automations/${id}/test-send`);
      showToast(`Teste simulado enviado via ${AUTOMATION_CHANNEL_LABELS[res.preview.channel] || res.preview.channel} às ${res.preview.sendTime}.`, 'success');
    } catch (err) { showToast(err.message, 'error'); }
  }

  /* ==========================================================================
     MODULE: RELATÓRIOS (visualização inline + download real)
     ========================================================================== */
  const REPORT_TABS = [
    { key: 'leads', label: 'Alunos e Leads', csv: '/reports/leads.csv' },
    { key: 'cursos', label: 'Cursos', csv: '/reports/courses.csv' },
    { key: 'calendario', label: 'Calendário', csv: '/reports/calendar.csv' },
    { key: 'auditoria', label: 'Auditoria', csv: '/reports/audit.csv', gestorOnly: true }
  ];

  async function renderRelatorios(container) {
    if (!state.reportsTab) state.reportsTab = 'leads';
    const visibleTabs = REPORT_TABS.filter(t => !t.gestorOnly || state.user.isGestor);

    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-group">
          <h2>Central de Relatórios Enterprise</h2>
          <p>Visualize os dados diretamente na tela e baixe o relatório completo quando precisar</p>
        </div>
      </div>
      <div class="tabs-bar">
        ${visibleTabs.map(t => `<button class="tab-btn ${state.reportsTab === t.key ? 'active' : ''}" data-report-tab="${t.key}">${esc(t.label)}</button>`).join('')}
      </div>
      <div id="report-body"></div>
    `;
    container.querySelectorAll('[data-report-tab]').forEach(btn => {
      btn.addEventListener('click', () => { state.reportsTab = btn.getAttribute('data-report-tab'); renderRelatorios(container); });
    });
    await renderReportBody();
  }

  async function renderReportBody() {
    const body = document.getElementById('report-body');
    const tab = REPORT_TABS.find(t => t.key === state.reportsTab);
    const canExport = tab.key === 'auditoria' ? can('configuracoes', 'export') : can('relatorios', 'export');
    const downloadBtn = canExport ? `<a class="btn btn-primary btn-sm" href="${api.downloadUrl(tab.csv)}"><i data-feather="download"></i> Baixar CSV/Excel</a>` : '';

    if (tab.key === 'leads') {
      const { leads } = await api.get('/leads');
      body.innerHTML = `
        <div class="data-table-container">
          <div class="table-toolbar"><span class="text-sub" style="font-size:0.8rem">${leads.length} registro(s)</span>${downloadBtn}</div>
          <div class="table-scroll"><table class="nexus-table">
            <thead><tr><th>Nome</th><th>Curso</th><th>Polo</th><th>Etapa</th><th>Temperatura</th><th>Canal</th><th>Origem</th></tr></thead>
            <tbody>${leads.map(l => `<tr><td><b>${esc(l.name)}</b></td><td>${esc(l.courseInterest || '—')}</td><td>${esc(l.polo || '—')}</td><td>${esc(stageLabel(l.stage))}</td><td><span class="temp-badge ${l.temperature}">${esc(tempInfo(l.temperature).label)}</span></td><td>${channelLabel(l.sourceChannel)}</td><td>${l.sourceType === 'pago' ? 'Anúncio' : 'Orgânico'}</td></tr>`).join('') || '<tr><td colspan="7">Sem dados.</td></tr>'}</tbody>
          </table></div>
        </div>`;
    } else if (tab.key === 'cursos') {
      const courses = state.coursesCache.length ? state.coursesCache : (await api.get('/courses')).courses;
      state.coursesCache = courses;
      body.innerHTML = `
        <div class="data-table-container">
          <div class="table-toolbar"><span class="text-sub" style="font-size:0.8rem">${courses.length} curso(s)</span>${downloadBtn}</div>
          <div class="table-scroll"><table class="nexus-table">
            <thead><tr><th>Curso</th><th>Modalidade</th><th>Mensalidade</th><th>Promocional</th><th>Alunos Ativos</th><th>Status</th></tr></thead>
            <tbody>${courses.map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.modalidade)}</td><td>${esc(c.mensalidade || '—')}</td><td>${esc(c.promotionalPrice || '—')}</td><td>${c.alunosAtivos}</td><td>${esc(c.status)}</td></tr>`).join('') || '<tr><td colspan="6">Sem dados.</td></tr>'}</tbody>
          </table></div>
        </div>`;
    } else if (tab.key === 'calendario') {
      const { events } = await api.get('/calendar');
      body.innerHTML = `
        <div class="data-table-container">
          <div class="table-toolbar"><span class="text-sub" style="font-size:0.8rem">${events.length} evento(s)${state.user.isGestor ? ' (toda a equipe)' : ' (sua agenda privada)'}</span>${downloadBtn}</div>
          <div class="table-scroll"><table class="nexus-table">
            <thead><tr><th>Título</th><th>Tipo</th><th>Data/Hora</th><th>Responsável</th><th>Privado</th></tr></thead>
            <tbody>${events.map(e => `<tr><td><b>${esc(e.title)}</b></td><td>${esc(e.type)}</td><td>${fmtDateTime(e.startsAt)}</td><td>${esc(e.ownerName || '—')}</td><td>${e.isPrivate ? 'Sim' : 'Não'}</td></tr>`).join('') || '<tr><td colspan="5">Sem dados.</td></tr>'}</tbody>
          </table></div>
        </div>`;
    } else if (tab.key === 'auditoria') {
      const { logs } = await api.get('/audit?limit=150');
      body.innerHTML = `
        <div class="data-table-container">
          <div class="table-toolbar"><span class="text-sub" style="font-size:0.8rem">${logs.length} registro(s) mais recentes</span>${downloadBtn}</div>
          <div class="table-scroll"><table class="nexus-table">
            <thead><tr><th>Data/Hora</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>Detalhes</th></tr></thead>
            <tbody>${logs.map(l => `<tr><td>${fmtDateTime(l.createdAt)}</td><td>${esc(l.userName)}</td><td>${esc(l.action)}</td><td>${esc(l.entity || '—')}</td><td>${esc(l.details || '')}</td></tr>`).join('') || '<tr><td colspan="5">Sem dados.</td></tr>'}</tbody>
          </table></div>
        </div>`;
    }
    refreshIcons();
  }

  /* ==========================================================================
     MODULE: INTEGRAÇÕES
     ========================================================================== */
  async function renderIntegracoes(container) {
    const { integrations } = await api.get('/integrations');
    state.integrationsCache = integrations;
    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-group">
          <h2>Hub de Integrações Enterprise</h2>
          <p>Conecte canais de captação — leads chegam automaticamente e são classificados pela IA. (Conexão e sincronização simuladas neste ambiente; o webhook de recebimento é real e funcional.)</p>
        </div>
      </div>
      <div class="card-list-grid">
        ${integrations.map(i => `
          <div class="kpi-card">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <h4 style="font-size:1rem; font-weight:700">${esc(i.label)}</h4>
              <span class="${i.status === 'connected' ? 'badge-connected' : 'badge-disconnected'}">${i.status === 'connected' ? 'Conectado' : 'Desconectado'}</span>
            </div>
            <p style="font-size:0.8rem; color:var(--text-sub)">${i.status === 'connected' ? 'Recebendo leads automaticamente.' : 'Conecte para começar a capturar leads deste canal.'}</p>
            ${i.status === 'connected' ? `
              <p style="font-size:0.72rem; color:var(--text-muted)">Chave de API: ${i.apiKeyMasked ? esc(i.apiKeyMasked) : 'não configurada'} · Auto-resposta: ${i.autoReply ? 'ativa' : 'inativa'}</p>
            ` : ''}
            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
              ${can('integracoes', 'edit') ? (i.status === 'connected'
                ? `<button class="btn btn-secondary btn-sm" data-action="integration-disconnect" data-id="${i.key}">Desconectar</button>`
                : `<button class="btn btn-primary btn-sm" data-action="integration-connect" data-id="${i.key}">Conectar</button>`) : ''}
              ${can('integracoes', 'edit') && i.status === 'connected' ? `<button class="btn btn-secondary btn-sm" data-action="integration-configure" data-id="${i.key}"><i data-feather="settings"></i> Configurar</button>` : ''}
              ${i.status === 'connected' ? `<button class="btn btn-secondary btn-sm" data-action="integration-test" data-id="${i.key}"><i data-feather="activity"></i> Testar Conexão</button>` : ''}
              ${can('integracoes', 'edit') && i.status === 'connected' ? `
                <button class="btn btn-secondary btn-sm" data-action="integration-simulate" data-id="${i.key}" data-source-type="organico">Simular Lead Orgânico</button>
                <button class="btn btn-secondary btn-sm" data-action="integration-simulate" data-id="${i.key}" data-source-type="pago">Simular Lead Pago</button>
              ` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
    refreshIcons();
  }

  function openIntegrationConfigModal(integration) {
    const webhookFullUrl = integration.webhookUrl ? `${location.origin}${integration.webhookUrl}` : null;
    openFormModal({
      title: `Configurar ${integration.label}`,
      submitLabel: 'Salvar Configuração',
      fields: [
        { name: 'apiKey', label: 'Chave de API / Token (simulado)', type: 'password', placeholder: integration.apiKeyMasked || 'Cole aqui a chave da plataforma', hint: 'Armazenada apenas para fins de demonstração.' },
        { name: 'autoReply', label: 'Responder automaticamente novas mensagens', type: 'checkbox', value: integration.autoReply }
      ],
      extraHtml: webhookFullUrl ? `
        <div class="form-group">
          <label>URL do Webhook (real — aceita POST de fora)</label>
          <input type="text" readonly value="${esc(webhookFullUrl)}" onclick="this.select();" style="background:var(--bg-input); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:10px 14px; font-size:0.78rem; width:100%;">
          <span class="form-hint">Envie um POST com JSON {"name": "...", "email": "...", "message": "..."} para esta URL a partir de qualquer ferramenta externa (Zapier, Make, curl) e um lead será criado de verdade nesta plataforma.</span>
        </div>
      ` : '',
      onSubmit: async (values) => {
        await api.put(`/integrations/${integration.key}/config`, values);
        showToast('Configuração salva.', 'success');
        await switchModule('integracoes');
      }
    });
  }

  /* ==========================================================================
     MODULE: CONFIGURAÇÕES (RBAC, Usuários, Cargos, Departamentos, Auditoria)
     ========================================================================== */
  async function renderConfiguracoes(container) {
    await ensureModulesMeta();
    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-group">
          <h2>Configurações e Permissões (RBAC)</h2>
          <p>Gestão de usuários, cargos, departamentos e permissões granulares</p>
        </div>
      </div>
      <div class="tabs-bar">
        <button class="tab-btn ${state.configTab === 'usuarios' ? 'active' : ''}" data-cfg-tab="usuarios">Usuários</button>
        <button class="tab-btn ${state.configTab === 'cargos' ? 'active' : ''}" data-cfg-tab="cargos">Cargos</button>
        <button class="tab-btn ${state.configTab === 'departamentos' ? 'active' : ''}" data-cfg-tab="departamentos">Departamentos</button>
        <button class="tab-btn ${state.configTab === 'permissoes' ? 'active' : ''}" data-cfg-tab="permissoes">Permissões Individuais</button>
        <button class="tab-btn ${state.configTab === 'auditoria' ? 'active' : ''}" data-cfg-tab="auditoria">Auditoria</button>
      </div>
      <div id="config-body"></div>
    `;
    container.querySelectorAll('[data-cfg-tab]').forEach(btn => {
      btn.addEventListener('click', () => { state.configTab = btn.getAttribute('data-cfg-tab'); renderConfiguracoes(container); });
    });
    await renderConfigTabBody();
  }

  async function renderConfigTabBody() {
    const body = document.getElementById('config-body');
    if (state.configTab === 'usuarios') return renderConfigUsuarios(body);
    if (state.configTab === 'cargos') return renderConfigCargos(body);
    if (state.configTab === 'departamentos') return renderConfigDepartamentos(body);
    if (state.configTab === 'permissoes') return renderConfigPermissoes(body);
    if (state.configTab === 'auditoria') return renderConfigAuditoria(body);
  }

  async function renderConfigUsuarios(body) {
    const [{ users }, { roles }, { departments }] = await Promise.all([api.get('/users'), api.get('/users/roles'), api.get('/users/departments')]);
    state.usersCache = users; state.rolesCache = roles; state.deptsCache = departments;

    body.innerHTML = `
      <div class="data-table-container">
        <div class="table-toolbar">
          <span class="text-sub" style="font-size:0.8rem">${users.length} usuário(s)</span>
          <button class="btn btn-primary btn-sm" data-action="user-new"><i data-feather="user-plus"></i> Novo Usuário</button>
        </div>
        <div class="table-scroll">
          <table class="nexus-table">
            <thead><tr><th>Nome</th><th>Usuário</th><th>Cargo</th><th>Departamento</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>
              ${users.map(u => `
                <tr>
                  <td><b>${esc(u.name)}</b></td>
                  <td>${esc(u.username)}</td>
                  <td>${esc(u.role)}</td>
                  <td>${esc(u.department || '—')}</td>
                  <td>${u.active ? '<span style="color:var(--accent-success)">Ativo</span>' : '<span style="color:var(--text-muted)">Inativo</span>'}</td>
                  <td class="row-actions">
                    <i class="icon-action" data-feather="edit-2" data-action="user-edit" data-id="${u.id}" title="Editar"></i>
                    <i class="icon-action" data-feather="key" data-action="user-reset-password" data-id="${u.id}" title="Redefinir senha"></i>
                    ${u.id !== state.user.id ? `<i class="icon-action danger" data-feather="trash-2" data-action="user-delete" data-id="${u.id}" title="Excluir"></i>` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    refreshIcons();
  }

  function openUserFormModal(existingUser) {
    const roleOptions = state.rolesCache.map(r => ({ value: r.id, label: r.name }));
    const deptOptions = [{ value: '', label: 'Sem departamento' }, ...state.deptsCache.map(d => ({ value: d.id, label: d.name }))];
    const fields = [
      { name: 'name', label: 'Nome completo', required: true, value: existingUser && existingUser.name }
    ];
    if (!existingUser) {
      fields.push({ name: 'username', label: 'Usuário (login)', required: true, placeholder: 'ex: joao.souza' });
      fields.push({ name: 'password', label: 'Senha inicial', type: 'password', required: true, hint: 'Mínimo 6 caracteres.' });
    }
    fields.push({ name: 'roleId', label: 'Cargo', type: 'select', options: roleOptions, value: existingUser && existingUser.roleId });
    fields.push({ name: 'departmentId', label: 'Departamento', type: 'select', options: deptOptions, value: existingUser && existingUser.departmentId });
    if (existingUser) fields.push({ name: 'active', label: 'Usuário ativo', type: 'checkbox', value: existingUser.active });

    openFormModal({
      title: existingUser ? 'Editar Usuário' : 'Novo Usuário',
      submitLabel: existingUser ? 'Salvar Alterações' : 'Criar Usuário',
      fields,
      onSubmit: async (values) => {
        if (existingUser) {
          await api.put(`/users/${existingUser.id}`, { name: values.name, roleId: Number(values.roleId), departmentId: values.departmentId ? Number(values.departmentId) : null, active: values.active });
        } else {
          await api.post('/users', { name: values.name, username: values.username, password: values.password, roleId: Number(values.roleId), departmentId: values.departmentId ? Number(values.departmentId) : null });
        }
        showToast(existingUser ? 'Usuário atualizado.' : 'Usuário criado.', 'success');
        await renderConfigTabBody();
      }
    });
  }

  function openResetPasswordModal(userId) {
    openFormModal({
      title: 'Redefinir Senha do Usuário',
      submitLabel: 'Redefinir',
      fields: [{ name: 'newPassword', label: 'Nova senha', type: 'password', required: true, hint: 'Mínimo 6 caracteres.' }],
      onSubmit: async (values) => {
        await api.post(`/users/${userId}/reset-password`, values);
        showToast('Senha redefinida com sucesso.', 'success');
      }
    });
  }

  async function renderConfigCargos(body) {
    const { roles } = await api.get('/users/roles');
    state.rolesCache = roles;
    body.innerHTML = `
      <div class="data-table-container">
        <div class="table-toolbar">
          <span class="text-sub" style="font-size:0.8rem">${roles.length} cargo(s)</span>
          <button class="btn btn-primary btn-sm" data-action="role-new"><i data-feather="plus"></i> Novo Cargo</button>
        </div>
        <div class="table-scroll">
          <table class="nexus-table">
            <thead><tr><th>Nome do Cargo</th><th>Tipo</th><th>Ações</th></tr></thead>
            <tbody>
              ${roles.map(r => `
                <tr>
                  <td><b>${esc(r.name)}</b></td>
                  <td>${r.isSystem ? 'Padrão do Sistema' : 'Personalizado'}</td>
                  <td class="row-actions">
                    <i class="icon-action" data-feather="shield" data-action="role-edit-perms" data-id="${r.id}" title="Editar permissões do cargo"></i>
                    ${!r.isSystem ? `<i class="icon-action danger" data-feather="trash-2" data-action="role-delete" data-id="${r.id}" title="Excluir"></i>` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    refreshIcons();
  }

  function openRoleCreateModal() {
    openFormModal({
      title: 'Novo Cargo', submitLabel: 'Criar Cargo',
      fields: [{ name: 'name', label: 'Nome do cargo', required: true }],
      onSubmit: async (values) => {
        await api.post('/users/roles', { name: values.name });
        showToast('Cargo criado. Configure as permissões dele em seguida.', 'success');
        await renderConfigTabBody();
      }
    });
  }

  async function openRolePermissionsModal(roleId) {
    await ensureModulesMeta();
    const role = state.rolesCache.find(r => r.id === roleId);
    if (!role) return;
    openFormModal({
      title: `Permissões do Cargo: ${role.name}`,
      submitLabel: 'Salvar Permissões',
      fields: [],
      extraHtml: buildPermMatrixHtml(role.defaultPermissions, 'role-perm-matrix'),
      onSubmit: async () => {
        const matrix = readPermMatrixFromDom('role-perm-matrix');
        await api.put(`/users/roles/${roleId}`, { defaultPermissions: matrix });
        showToast('Permissões do cargo atualizadas.', 'success');
        await renderConfigTabBody();
      }
    });
  }

  async function renderConfigDepartamentos(body) {
    const { departments } = await api.get('/users/departments');
    state.deptsCache = departments;
    body.innerHTML = `
      <div class="data-table-container">
        <div class="table-toolbar">
          <span class="text-sub" style="font-size:0.8rem">${departments.length} departamento(s)</span>
          <button class="btn btn-primary btn-sm" data-action="dept-new"><i data-feather="plus"></i> Novo Departamento</button>
        </div>
        <div class="table-scroll">
          <table class="nexus-table">
            <thead><tr><th>Departamento</th><th>Permissões Próprias</th><th>Ações</th></tr></thead>
            <tbody>
              ${departments.map(d => `
                <tr>
                  <td><b>${esc(d.name)}</b></td>
                  <td>${d.defaultPermissions ? 'Personalizadas' : 'Herda do cargo do usuário'}</td>
                  <td class="row-actions">
                    <i class="icon-action" data-feather="shield" data-action="dept-edit-perms" data-id="${d.id}" title="Editar permissões do departamento"></i>
                    <i class="icon-action danger" data-feather="trash-2" data-action="dept-delete" data-id="${d.id}" title="Excluir"></i>
                  </td>
                </tr>
              `).join('') || '<tr><td colspan="3">Nenhum departamento cadastrado.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
    refreshIcons();
  }

  function openDeptCreateModal() {
    openFormModal({
      title: 'Novo Departamento', submitLabel: 'Criar Departamento',
      fields: [{ name: 'name', label: 'Nome do departamento', required: true }],
      onSubmit: async (values) => {
        await api.post('/users/departments', { name: values.name });
        showToast('Departamento criado.', 'success');
        await renderConfigTabBody();
      }
    });
  }

  async function openDeptPermissionsModal(deptId) {
    await ensureModulesMeta();
    const dept = state.deptsCache.find(d => d.id === deptId);
    if (!dept) return;
    openFormModal({
      title: `Permissões do Departamento: ${dept.name}`,
      submitLabel: 'Salvar Permissões',
      fields: [],
      extraHtml: `
        <p class="form-hint" style="margin-bottom:8px;">Marque as permissões que este departamento deve sobrepor ao cargo do usuário. Use "Remover Substituição" para voltar a herdar do cargo.</p>
        ${buildPermMatrixHtml(dept.defaultPermissions || {}, 'dept-perm-matrix')}
        <button type="button" class="btn btn-secondary btn-sm" id="dept-clear-perms" style="margin-top:10px;">Remover Substituição (usar padrão do cargo)</button>
      `,
      onSubmit: async () => {
        const matrix = readPermMatrixFromDom('dept-perm-matrix');
        await api.put(`/users/departments/${deptId}`, { defaultPermissions: matrix });
        showToast('Permissões do departamento atualizadas.', 'success');
        await renderConfigTabBody();
      }
    });
    document.getElementById('dept-clear-perms').addEventListener('click', async () => {
      await api.put(`/users/departments/${deptId}`, { defaultPermissions: null });
      showToast('Departamento voltou a herdar do cargo.', 'success');
      closeFormModal();
      await renderConfigTabBody();
    });
  }

  async function renderConfigPermissoes(body) {
    const { users } = await api.get('/users');
    state.usersCache = users;
    await ensureModulesMeta();
    if (!state.configPermUserId && users.length) state.configPermUserId = users[0].id;

    body.innerHTML = `
      <div class="chart-card">
        <div class="form-group" style="max-width:320px;">
          <label>Selecione o usuário</label>
          <select id="perm-user-select">
            ${users.map(u => `<option value="${u.id}" ${u.id === state.configPermUserId ? 'selected' : ''}>${esc(u.name)} (${esc(u.role)})</option>`).join('')}
          </select>
        </div>
        <div id="perm-matrix-holder" style="margin-top:16px;"></div>
        <div style="display:flex; gap:10px; margin-top:16px;">
          <button class="btn btn-primary" id="perm-save-btn">Salvar Permissões Individuais</button>
          <button class="btn btn-secondary" id="perm-reset-btn">Restaurar Padrão do Cargo/Departamento</button>
        </div>
      </div>
    `;

    function renderMatrixForUser() {
      const user = state.usersCache.find(u => u.id === state.configPermUserId);
      document.getElementById('perm-matrix-holder').innerHTML = buildPermMatrixHtml(user ? user.permissions : {}, 'user-perm-matrix');
      refreshIcons();
    }
    renderMatrixForUser();

    document.getElementById('perm-user-select').addEventListener('change', (e) => {
      state.configPermUserId = Number(e.target.value);
      renderMatrixForUser();
    });
    document.getElementById('perm-save-btn').addEventListener('click', async () => {
      const matrix = readPermMatrixFromDom('user-perm-matrix');
      await api.put(`/users/${state.configPermUserId}/permissions`, { permissions: matrix });
      showToast('Permissões individuais salvas.', 'success');
    });
    document.getElementById('perm-reset-btn').addEventListener('click', async () => {
      await api.del(`/users/${state.configPermUserId}/permissions`);
      showToast('Permissões restauradas ao padrão do cargo/departamento.', 'success');
      await renderConfigPermissoes(body);
    });
  }

  async function renderConfigAuditoria(body) {
    const { logs } = await api.get('/audit?limit=150');
    body.innerHTML = `
      <div class="data-table-container">
        <div class="table-toolbar">
          <span class="text-sub" style="font-size:0.8rem">${logs.length} registro(s) mais recentes</span>
          ${can('configuracoes', 'export') ? `<a class="btn btn-secondary btn-sm" href="${api.downloadUrl('/reports/audit.csv')}">Exportar CSV</a>` : ''}
        </div>
        <div class="table-scroll">
          <table class="nexus-table">
            <thead><tr><th>Data/Hora</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>Detalhes</th></tr></thead>
            <tbody>
              ${logs.map(l => `<tr><td>${fmtDateTime(l.createdAt)}</td><td>${esc(l.userName)}</td><td>${esc(l.action)}</td><td>${esc(l.entity || '—')}</td><td>${esc(l.details || '')}</td></tr>`).join('') || '<tr><td colspan="5">Nenhum registro ainda.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  /* ==========================================================================
     GLOBAL DELEGATED ACTION HANDLER
     ========================================================================== */
  async function handleGlobalAction(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.getAttribute('data-action');
    const id = el.getAttribute('data-id');

    try {
      switch (action) {
        case 'goto-module': {
          document.getElementById('command-modal').classList.add('hidden');
          const link = document.querySelector(`.nav-link[data-module="${id}"]`);
          if (link) { document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active')); link.classList.add('active'); }
          await switchModule(id);
          break;
        }
        case 'open-lead':
          document.getElementById('command-modal').classList.add('hidden');
          await openLeadPanel(Number(id));
          break;
        case 'lead-new':
          if (!state.coursesCache.length) { try { state.coursesCache = (await api.get('/courses')).courses; } catch { /* ignore */ } }
          openLeadFormModal(null);
          break;
        case 'lead-edit': {
          const { lead } = await api.get(`/leads/${id}`);
          if (!state.coursesCache.length) { try { state.coursesCache = (await api.get('/courses')).courses; } catch { /* ignore */ } }
          openLeadFormModal(lead);
          break;
        }
        case 'lead-delete':
          if (confirmAction('Excluir este lead permanentemente?')) {
            await api.del(`/leads/${id}`);
            showToast('Lead excluído.', 'success');
            closeLeadPanel();
            if (state.currentModule === 'pipelines') await switchModule('pipelines');
          }
          break;
        case 'lead-rescan': {
          await api.post(`/leads/${id}/rescan`);
          showToast('Lead reclassificado pela IA.', 'success');
          await openLeadPanel(Number(id));
          break;
        }
        case 'pipelines-tab':
          state.pipelinesTab = id;
          await renderPipelines(document.getElementById('main-content'));
          break;

        case 'stage-manager-open': openStageManagerModal(); break;
        case 'stage-move-up':
        case 'stage-move-down':
          await api.post(`/stages/${id}/move`, { direction: action === 'stage-move-up' ? 'up' : 'down' });
          await refreshStagesCache();
          renderStageManagerList();
          if (state.currentModule === 'pipelines') renderKanbanBoard();
          break;
        case 'stage-delete':
          if (confirmAction('Excluir esta etapa? Só é possível se nenhum lead estiver nela no momento.')) {
            await api.del(`/stages/${id}`);
            await refreshStagesCache();
            renderStageManagerList();
            showToast('Etapa excluída.', 'success');
            if (state.currentModule === 'pipelines') renderKanbanBoard();
          }
          break;

        case 'event-new': await openEventFormModal(null); break;
        case 'event-edit': {
          const { events } = await api.get('/calendar');
          const evt = events.find(x => x.id === Number(id));
          await openEventFormModal(evt);
          break;
        }
        case 'event-delete':
          if (confirmAction('Excluir este evento?')) {
            await api.del(`/calendar/${id}`);
            showToast('Evento excluído.', 'success');
            await switchModule('calendario');
          }
          break;

        case 'course-new': openCourseFormModal(null); break;
        case 'course-edit': openCourseFormModal(state.coursesCache.find(c => c.id === Number(id))); break;
        case 'course-delete':
          if (confirmAction('Excluir este curso?')) {
            await api.del(`/courses/${id}`);
            showToast('Curso excluído.', 'success');
            await switchModule('cursos');
          }
          break;

        case 'ai-quick': sendAiPrompt(id); break;

        case 'team-group-new': await openTeamGroupCreateModal(); break;
        case 'team-group-add-member': await openAddTeamMemberModal(Number(id)); break;
        case 'team-group-remove-member':
          if (confirmAction('Remover este membro do grupo?')) {
            await api.del(`/teamchat/groups/${id}/members/${el.getAttribute('data-user-id')}`);
            showToast('Membro removido.', 'success');
            await switchModule('comunicacoes');
          }
          break;

        case 'automation-new': openAutomationFormModal(); break;
        case 'automation-edit': openAutomationFormModal((state.automationsCache || []).find(a => a.id === Number(id))); break;
        case 'automation-toggle': await api.patch(`/automations/${id}/toggle`); await switchModule('automacoes'); break;
        case 'automation-run':
          await api.post(`/automations/${id}/run`);
          showToast('Automação executada (simulação).', 'success');
          await switchModule('automacoes');
          break;
        case 'automation-test-send': await testSendAutomation(id); break;
        case 'automation-delete':
          if (confirmAction('Excluir esta automação?')) {
            await api.del(`/automations/${id}`);
            showToast('Automação excluída.', 'success');
            await switchModule('automacoes');
          }
          break;
        case 'automation-template-add': {
          const tpl = AUTOMATION_TEMPLATES.find(t => t.key === id);
          if (tpl) {
            await api.post('/automations', { name: tpl.name, description: tpl.description, triggerDesc: tpl.triggerDesc, channel: tpl.channel, sendTime: tpl.sendTime, message: tpl.preview });
            showToast(`Automação "${tpl.name}" adicionada e ativada.`, 'success');
            await switchModule('automacoes');
          }
          break;
        }

        case 'integration-connect': await api.post(`/integrations/${id}/connect`); showToast('Integração conectada.', 'success'); await switchModule('integracoes'); break;
        case 'integration-disconnect': await api.post(`/integrations/${id}/disconnect`); showToast('Integração desconectada.', 'info'); await switchModule('integracoes'); break;
        case 'integration-configure': {
          const integration = (state.integrationsCache || []).find(i => i.key === id);
          if (integration) openIntegrationConfigModal(integration);
          break;
        }
        case 'integration-test': {
          const res = await api.post(`/integrations/${id}/test`);
          showToast(`Conexão OK — resposta em ${res.latencyMs}ms.`, 'success');
          break;
        }
        case 'integration-simulate': {
          const sourceType = el.getAttribute('data-source-type');
          const res = await api.post(`/integrations/${id}/simulate-lead`, { sourceType });
          showToast(`Novo lead simulado: ${res.lead.name} (classificado como ${res.ai.temperature}).`, 'success');
          break;
        }

        case 'user-new': openUserFormModal(null); break;
        case 'user-edit': openUserFormModal(state.usersCache.find(u => u.id === Number(id))); break;
        case 'user-reset-password': openResetPasswordModal(id); break;
        case 'user-delete':
          if (confirmAction('Excluir este usuário permanentemente?')) {
            await api.del(`/users/${id}`);
            showToast('Usuário excluído.', 'success');
            await renderConfigTabBody();
          }
          break;

        case 'role-new': openRoleCreateModal(); break;
        case 'role-edit-perms': await openRolePermissionsModal(Number(id)); break;
        case 'role-delete':
          if (confirmAction('Excluir este cargo?')) {
            await api.del(`/users/roles/${id}`);
            showToast('Cargo excluído.', 'success');
            await renderConfigTabBody();
          }
          break;

        case 'dept-new': openDeptCreateModal(); break;
        case 'dept-edit-perms': await openDeptPermissionsModal(Number(id)); break;
        case 'dept-delete':
          if (confirmAction('Excluir este departamento?')) {
            await api.del(`/users/departments/${id}`);
            showToast('Departamento excluído.', 'success');
            await renderConfigTabBody();
          }
          break;
      }
    } catch (err) {
      showToast(err.message || 'Ocorreu um erro.', 'error');
    }
  }
})();
