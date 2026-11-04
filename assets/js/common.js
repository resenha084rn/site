/* Resenha084 — utilitários compartilhados (JS puro) */
(function () {
  const ROOT = new URL('../../', document.currentScript.src).href;
  const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const DIAS_CURTO = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
  const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

  const R = {
    ROOT, DIAS, DIAS_CURTO, MESES,
    esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
    async json(path) {
      const r = await fetch(ROOT + path + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error(path + ' ' + r.status);
      return r.json();
    },
    url(path) { return /^(https?:|data:|blob:)/.test(path) ? path : ROOT + path; },
    /* Natal/RN = UTC-3 o ano todo (sem horário de verão) */
    agoraBR() { return new Date(Date.now() - 3 * 3600e3); },
    hojeStr() { return R.agoraBR().toISOString().slice(0, 10); },
    parseData(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); },
    diaSemanaDe(s) { return R.parseData(s).getUTCDay(); },
    hora(h) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(h || '');
      if (!m) return h || '';
      return m[2] === '00' ? Number(m[1]) + 'h' : Number(m[1]) + 'h' + m[2];
    },
    preco(ev) { return ev.gratis ? 'Grátis' : (ev.preco || 'A confirmar'); },
    mapaUrl(ev) {
      if (ev.mapa) return ev.mapa;
      return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([ev.local, ev.endereco || 'Natal RN'].filter(Boolean).join(', '));
    },
    /* próxima ocorrência (YYYY-MM-DD) de um evento fixo semanal */
    proximaFixo(ev) {
      const hoje = R.agoraBR();
      const diff = (ev.diaSemana - hoje.getUTCDay() + 7) % 7;
      const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() + diff));
      return d.toISOString().slice(0, 10);
    },
    ics(ev, dataStr) {
      const dt = dataStr.replace(/-/g, '');
      const m = /^(\d{1,2}):(\d{2})$/.exec(ev.horario || '');
      let ini, fim;
      if (m) {
        const h = Number(m[1]), mi = m[2];
        const hf = String((h + 4) % 24).padStart(2, '0');
        ini = `DTSTART;TZID=America/Fortaleza:${dt}T${String(h).padStart(2, '0')}${mi}00`;
        fim = `DTEND;TZID=America/Fortaleza:${dt}T${hf}${mi}00`;
      } else {
        ini = `DTSTART;VALUE=DATE:${dt}`;
        fim = `DTEND;VALUE=DATE:${dt}`;
      }
      const t = s => String(s || '').replace(/[,;\\]/g, m => '\\' + m).replace(/\n/g, '\\n');
      return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Resenha084//Agenda//PT', 'BEGIN:VEVENT',
        'UID:' + ev.id + '-' + dt + '@resenha084', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]|\.\d{3}/g, ''),
        ini, fim, 'SUMMARY:' + t(ev.titulo), 'LOCATION:' + t([ev.local, ev.endereco].filter(Boolean).join(' - ')),
        'DESCRIPTION:' + t((ev.artistas || []).join(', ') + (ev.descricao ? '\n' + ev.descricao : '')),
        'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    },
    baixar(nome, texto, tipo) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([texto], { type: tipo }));
      a.download = nome; document.body.appendChild(a); a.click(); a.remove();
    }
  };
  /* ---------- Firebase (leitura pública via REST, sem SDK nas páginas públicas) ---------- */
  R.fbOk = () => { const c = window.FB && window.FB.config; return !!(c && c.apiKey && !/^COLE/.test(c.apiKey)); };
  R.docFB = async (col, id) => {
    const c = window.FB.config;
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${c.projectId}/databases/(default)/documents/${col}/${encodeURIComponent(id)}?key=${c.apiKey}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('Firestore ' + r.status);
    return (await r.json()).fields || {};
  };
  /* conteúdo do site: Firestore primeiro; se não configurado/vazio/fora do ar, cai no data/*.json */
  const memo = {};   // a mesma página/scripts reaproveitam a leitura (landing + som)
  R.conteudo = (nome, fallback) => memo[nome] || (memo[nome] = (async () => {
    if (R.fbOk()) {
      try { const f = await R.docFB('conteudo', nome); if (f && f.json) return JSON.parse(f.json.stringValue); }
      catch (e) { console.warn('Firebase indisponível, usando JSON local', e); }
    }
    return R.json(fallback);
  })());
  /* flyers: "fb:ID" = imagem guardada no Firestore (texto base64); outro valor = arquivo do repositório */
  R.flyerData = async id => {
    const k = 'r84_fl_' + id;
    try { const c = localStorage.getItem(k); if (c) return c; } catch (e) { }
    const f = R.fbOk() ? await R.docFB('flyers', id) : null;
    const d = f && f.data && f.data.stringValue;
    if (d) { try { localStorage.setItem(k, d); } catch (e) { } }
    return d || '';
  };
  R.imgTag = (ref, alt) => String(ref).startsWith('fb:')
    ? `<img data-fb="${R.esc(ref.slice(3))}" alt="${R.esc(alt)}">`
    : `<img src="${R.esc(R.url(ref))}" alt="${R.esc(alt)}" loading="lazy">`;
  R.hidratar = (root = document) => root.querySelectorAll('[data-fb]').forEach(async el => {
    if (el.dataset.ok) return; el.dataset.ok = '1';
    try { const d = await R.flyerData(el.dataset.fb); if (!d) return; if (el.tagName === 'IMG') el.src = d; else el.style.backgroundImage = `url('${d}')`; }
    catch (e) { console.warn('flyer', e); }
  });

  window.R = R;
})();
