import '../test-support/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNotification } from '../server/jobs/progress.js';

test('parseNotification: "jobId:eventId" del NOTIFY del worker', () => {
  assert.deepEqual(parseNotification('5cc0dab5-3f89-4266-84b2-7834f7709bfc:42'),
    { jobId: '5cc0dab5-3f89-4266-84b2-7834f7709bfc', eventId: 42 });
  assert.equal(parseNotification('basura'), null);
  assert.equal(parseNotification(''), null);
  assert.equal(parseNotification('5cc0dab5-3f89-4266-84b2-7834f7709bfc:x'), null);
});
