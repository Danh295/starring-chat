'use strict';

// Optional "Now starring @user as The Role" chat messages via the Send Chat Message endpoint.
function createAnnouncer({ auth, config, log }) {
  let botId = null;
  async function getBotId() {
    if (botId) return botId;
    const res = await auth.helix(`/users?login=${encodeURIComponent(config.botUsername)}`);
    if (!res.ok) throw new Error(`bot lookup failed (${res.status})`);
    const { data = [] } = await res.json();
    if (!data[0]) throw new Error('bot account not found');
    botId = data[0].id;
    return botId;
  }
  return {
    async send(broadcasterId, message) {
      try {
        const sender = await getBotId();
        const res = await auth.helix('/chat/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ broadcaster_id: broadcasterId, sender_id: sender, message: String(message).slice(0, 500) }),
        });
        if (!res.ok) log.warn(`Could not post to chat (${res.status})`);
      } catch (err) {
        log.warn('Could not post to chat:', err.message);
      }
    },
  };
}

module.exports = { createAnnouncer };
