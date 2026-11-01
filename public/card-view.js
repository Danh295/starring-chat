// Builds the cast card DOM. Shared by the OBS overlay and the setup page's live preview, so what
// the streamer previews is exactly what viewers see. All text goes in with textContent (never innerHTML).
(function (root) {
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // Returns a card in its "casting" phase (a progress bar). Call reveal() to show the role.
  function build(msg) {
    var m = root.OverlayCore.cardModel(msg);
    var node = el('div', 'card casting tier-' + m.tier + ' ' + m.className);
    node.style.setProperty('--name-color', m.color);

    var hud = el('div', 'hud');
    hud.appendChild(el('div', 'hud-text', 'Casting director is picking a role'));
    var bar = el('div', 'hud-bar');
    bar.appendChild(el('i'));
    hud.appendChild(bar);
    node.appendChild(hud);

    var frame = el('div', 'frame');
    var shell = el('div', 'shell');
    var top = el('div', 'top');
    top.appendChild(el('div', 'tile', m.initial));
    var id = el('div', 'id');
    id.appendChild(el('div', 'name', m.who));
    id.appendChild(el('div', 'verb', m.verb));
    top.appendChild(id);
    top.appendChild(el('div', 'tag', m.badge || m.label));
    shell.appendChild(top);
    shell.appendChild(el('div', 'role', m.role));
    if (m.logline) shell.appendChild(el('div', 'logline', m.logline));
    frame.appendChild(shell);
    node.appendChild(frame);
    return node;
  }

  function reveal(node) { node.classList.remove('casting'); }

  root.CardView = { build: build, reveal: reveal };
})(window);
