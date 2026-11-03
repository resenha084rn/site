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
  window.R = R;
})();
