import assert from 'node:assert/strict';

import { bytes } from './files.mjs';

// promptfoo trims text file vars. Restore the exact frozen prompt, including
// its final newline, before constructing the message. Never read Gold here.
export default function messages({ vars }) {
  const internal = ['__evalId', '__evalStepId', '__repeatIndex'];
  assert.deepEqual(
    Object.keys(vars)
      .filter((k) => !internal.includes(k))
      .sort(),
    ['case_id', 'image', 'question'],
  );
  const result = caseMessages(vars.case_id);
  assert.equal(
    vars.question,
    result[0].content[0].text.trim(),
    'Loaded question differs from frozen input',
  );
  assert.equal(
    vars.image,
    result[0].content[1].image_url.url,
    'Loaded image differs from frozen input',
  );
  return result;
}

export function caseMessages(caseId) {
  assert.match(caseId, /^(canvas|webapp|photo|poster|chart|document)-\d{3}$/);
  const question = bytes(`prompts/${caseId}.txt`).toString('utf8');
  const image = `data:image/png;base64,${bytes(`images/${caseId}.png`).toString('base64')}`;
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
