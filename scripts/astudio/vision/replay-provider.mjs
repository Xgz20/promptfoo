import assert from 'node:assert/strict';

import { fixtureFor, hash } from './files.mjs';

export default class ReplayProvider {
  constructor(options) {
    this.history = options.config.history;
  }
  id() {
    return `history:${this.history}`;
  }
  async callApi(prompt, context) {
    const meta = context.test.metadata;
    const f = fixtureFor(this.history, meta.case_id);
    // Verify the actual serialized model message, after promptfoo rendering.
    // Any leaked metadata/Gold, extra instructions or input byte change fails.
    const message = JSON.parse(prompt);
    assert.equal(message.length, 1);
    assert.deepEqual(Object.keys(message[0]).sort(), ['content', 'role']);
    assert.equal(message[0].role, 'user');
    const [text, image] = message[0].content;
    assert.equal(message[0].content.length, 2);
    assert.deepEqual(Object.keys(text).sort(), ['text', 'type']);
    assert.equal(text.type, 'text');
    assert.equal(hash(text.text), f.prompt_sha256);
    assert.equal(meta.prompt_sha256, f.prompt_sha256);
    assert.deepEqual(Object.keys(image).sort(), ['image_url', 'type']);
    assert.equal(image.type, 'image_url');
    assert.deepEqual(Object.keys(image.image_url), ['url']);
    assert.ok(image.image_url.url.startsWith('data:image/png;base64,'));
    assert.equal(hash(Buffer.from(image.image_url.url.split(',')[1], 'base64')), f.image_sha256);
    assert.equal(meta.image_sha256, f.image_sha256);
    assert.equal(hash(f.raw_answer), f.answer_sha256);
    return {
      output: f.raw_answer,
      cached: false,
      cost: 0,
      metadata: {
        history_key: this.history,
        case_id: meta.case_id,
        status: f.status,
        answer_sha256: f.answer_sha256,
        input_verified: true,
        replay_only: true,
        new_model_calls: 0,
      },
    };
  }
}
