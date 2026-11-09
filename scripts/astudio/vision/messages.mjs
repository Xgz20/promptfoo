import assert from 'node:assert/strict';

import { bytes } from './files.mjs';

// promptfoo trims text file vars. Restore the exact frozen prompt, including
// its final newline, before constructing the message. Never read Gold here.
export default function messages({ vars }) {
  assert.match(vars.case_id, /^(canvas|webapp|photo|poster|chart|document)-\d{3}$/);
  const internal = ['__evalId', '__evalStepId', '__repeatIndex'];
  assert.deepEqual(
    Object.keys(vars)
      .filter((k) => !internal.includes(k))
      .sort(),
    ['case_id', 'image', 'question'],
  );
  const question = bytes(`prompts/${vars.case_id}.txt`).toString('utf8');
  assert.equal(vars.question, question.trim(), 'Loaded question differs from frozen input');
  const image = `data:image/png;base64,${bytes(`images/${vars.case_id}.png`).toString('base64')}`;
  assert.equal(vars.image, image, 'Loaded image differs from frozen input');
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: question },
        { type: 'image_url', image_url: { url: image } },
      ],
    },
  ];
}
