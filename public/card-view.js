// Builds the cast card (a sign plate). Shared by the stream overlay and the setup page preview, so what a
// streamer previews is what viewers see. Every string goes in with textContent, never innerHTML.
(function (root) {
  // How long the casting bar shows before the role is revealed.
  var TYPING_MS = 1500;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // Returns a card in its casting phase. Call reveal() to swap in the plate.
  function build(msg) {
    if (!root.OverlayCore) throw new Error('card-view.js needs overlay-core.js loaded first');
    var m = root.OverlayCore.cardModel(msg);
    var card = el('div', 'card casting tier-' + m.tier);

    var casting = el('div', 'casting-sign');
    casting.appendChild(el('p', 'casting-text', 'Casting director is picking a role'));
    var track = el('div', 'casting-track');
    track.appendChild(el('i'));
    casting.appendChild(track);
    card.appendChild(casting);

    var plate = el('div', 'plate');
    var top = el('div', 'plate-top');
    top.appendChild(el('div', 'line-square', m.initial));
    var who = el('div', 'plate-who');
    who.appendChild(el('p', 'plate-name', m.who));
    who.appendChild(el('p', 'plate-verb', m.verb));
    top.appendChild(who);
    plate.appendChild(top);
    plate.appendChild(el('p', 'plate-role', m.role));
    if (m.logline) plate.appendChild(el('p', 'plate-line', m.logline));
    plate.appendChild(el('p', 'plate-tier', m.badge || m.label));
    card.appendChild(plate);
    return card;
  }

  function reveal(card) { card.classList.remove('casting'); }

  root.CardView = { build: build, reveal: reveal, TYPING_MS: TYPING_MS };
})(window);
