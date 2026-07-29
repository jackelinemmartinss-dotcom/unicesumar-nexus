'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');

require('./db'); // ensures schema + seed run before anything else

const { router: authRouter, requireAuth } = require('./auth');
const usersRoutes = require('./routes/users.routes');
const { router: leadsRoutes } = require('./routes/leads.routes');
const calendarRoutes = require('./routes/calendar.routes');
const coursesRoutes = require('./routes/courses.routes');
const integrationsRoutes = require('./routes/integrations.routes');
const automationsRoutes = require('./routes/automations.routes');
const reportsRoutes = require('./routes/reports.routes');
const insightsRoutes = require('./routes/insights.routes');
const auditRoutes = require('./routes/audit.routes');
const teamchatRoutes = require('./routes/teamchat.routes');
const stagesRoutes = require('./routes/stages.routes');
const webhooksRoutes = require('./routes/webhooks.routes');

const app = express();
const PORT = process.env.PORT || 4000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

app.disable('x-powered-by');
app.use(express.json());
app.use(session({
  name: 'nexus.sid',
  secret: process.env.SESSION_SECRET || 'nexus-unicesumar-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 12 // 12h
  }
}));

// ---------- API ----------
// Public webhook receiver — secured by a per-integration token in the URL, not by session.
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/auth', authRouter);
app.use('/api/users', requireAuth, usersRoutes);
app.use('/api/leads', requireAuth, leadsRoutes);
app.use('/api/calendar', requireAuth, calendarRoutes);
app.use('/api/courses', requireAuth, coursesRoutes);
app.use('/api/integrations', requireAuth, integrationsRoutes);
app.use('/api/automations', requireAuth, automationsRoutes);
app.use('/api/reports', requireAuth, reportsRoutes);
app.use('/api/insights', requireAuth, insightsRoutes);
app.use('/api/audit', requireAuth, auditRoutes);
app.use('/api/teamchat', requireAuth, teamchatRoutes);
app.use('/api/stages', requireAuth, stagesRoutes);

// ---------- Static front-end ----------
// login.html, css and js are always public. index.html (the app shell) requires
// an active session — unauthenticated visitors are redirected to the login page.
app.get(['/', '/index.html'], (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login.html');
  }
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use(express.static(PUBLIC_DIR));

app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

app.listen(PORT, () => {
  console.log(`\n  UniCesumar Nexus rodando em http://localhost:${PORT}`);
  console.log(`  Acesse http://localhost:${PORT}/login.html para entrar.\n`);
});
