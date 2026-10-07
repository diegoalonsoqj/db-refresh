// Aplica el último tema usado antes del primer pintado para evitar el parpadeo.
// Es un archivo aparte (no inline) porque la CSP de helmet bloquea scripts inline.
// Debe mantenerse en sincronía con src/theme/ThemeContext.jsx.
(function () {
  var pref = { theme: 'blue', mode: 'dark' };
  try {
    var saved = JSON.parse(localStorage.getItem('dbrefresh.appearance') || 'null');
    if (saved) pref = saved;
  } catch (e) { /* sin storage: valores por defecto */ }
  var dark = pref.mode === 'system'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : pref.mode !== 'light';
  var root = document.documentElement;
  root.setAttribute('data-theme', pref.theme || 'blue');
  root.setAttribute('data-mode', dark ? 'dark' : 'light');
})();
