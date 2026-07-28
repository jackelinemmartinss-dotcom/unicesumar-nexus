/* ==========================================================================
   NEXUS API CLIENT - fetch wrapper with session cookie + 401 handling
   ========================================================================== */
window.NexusAPI = (function () {
  'use strict';

  async function request(method, path, body) {
    const opts = {
      method,
      credentials: 'include',
      headers: {}
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }

    const res = await fetch('/api' + path, opts);

    if (res.status === 401) {
      if (!location.pathname.endsWith('login.html')) {
        location.href = '/login.html';
      }
      throw new Error('Não autenticado.');
    }

    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await res.json() : await res.text();

    if (!res.ok) {
      const message = (data && data.error) ? data.error : 'Erro inesperado.';
      throw new Error(message);
    }
    return data;
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body || {}),
    put: (path, body) => request('PUT', path, body || {}),
    patch: (path, body) => request('PATCH', path, body || {}),
    del: (path) => request('DELETE', path),
    downloadUrl: (path) => '/api' + path
  };
})();
