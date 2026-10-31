'use strict';

// Lazy OpenAI client: never constructed without a key, so the app (and demo mode) runs
// without one. maxRetries 0 keeps the 3 second casting budget honest.
function createOpenAIGetter({ apiKey, OpenAI = require('openai') }) {
  let client;
  return function getClient() {
    if (!apiKey) return null;
    if (client === undefined) {
      try {
        const Ctor = OpenAI.OpenAI || OpenAI.default || OpenAI;
        client = new Ctor({ apiKey, maxRetries: 0, timeout: 4000 });
      } catch {
        client = null;
      }
    }
    return client;
  };
}

module.exports = { createOpenAIGetter };
