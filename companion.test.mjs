import assert from 'node:assert/strict';
import { newState, parseState, beginSession, elapsed, checkpoint, pauseSession,
  resumeSession, recoverSession, finishSession } from './companion.mjs';

const s = newState();
const start = 1700000000000;
assert.equal(beginSession(s, { minutes: 25, station: '深夜 Lo-fi', intent: '写一段', id: 'first', now: start }), true);
assert.equal(beginSession(s, { minutes: 10, station: '深夜 Lo-fi', id: 'duplicate', now: start }), false);
// Missing callbacks still produce the right wall-clock duration.
assert.equal(elapsed(s.active, start + 90000), 90000);
pauseSession(s, 'paused', start + 90000);
assert.equal(elapsed(s.active, start + 3600000), 90000);
resumeSession(s, start + 3600000);
checkpoint(s, start + 3660000);
assert.equal(elapsed(s.active, start + 3660000), 150000);
checkpoint(s, start + 3650000);
assert.equal(elapsed(s.active, start + 3660000), 150000, 'backwards clock never removes saved time');

const restored = parseState(JSON.stringify(s));
recoverSession(restored);
assert.equal(restored.active.phase, 'recovery');
assert.equal(elapsed(restored.active, start + 86400000), 150000, 'closed time is excluded');
assert.equal(restored.records.length, 0, 'restoring does not create a record');
assert.equal(finishSession(restored, 'nose'), null, 'closing must be explicit');
pauseSession(restored, 'closing', start + 86400000);
const midClosing = parseState(JSON.stringify(restored));
recoverSession(midClosing);
assert.equal(midClosing.active.phase, 'closing', 'refresh keeps pending closing');
finishSession(midClosing, 'nose', 'rest', start + 86400000 + 1000);
assert.equal(midClosing.ritual, 'nose');
assert.equal(midClosing.records[0].elapsedMs, 150000);
assert.equal(finishSession(midClosing, 'head'), null, 'double confirmation is idempotent');
assert.equal(midClosing.records.length, 1);
assert.equal(parseState(JSON.stringify(midClosing)).ritual, 'nose', 'ritual survives reload');

beginSession(midClosing, { minutes: 10, station: '森林午后 Bossa', id: 'second', now: start + 86400000 + 5000 });
pauseSession(midClosing, 'closing', start + 86400000 + 65000);
finishSession(midClosing, null, '', start + 86400000 + 66000);
assert.equal(midClosing.ritual, 'nose', 'skipping never forgets an existing ritual');
assert.equal(midClosing.records.length, 2, 'short sessions are valid');
assert.deepEqual(parseState(JSON.stringify(midClosing)), midClosing);
assert.throws(() => parseState('{broken'));
assert.throws(() => parseState(JSON.stringify({ ...midClosing, version: 2 })));
assert.throws(() => parseState(JSON.stringify({ ...midClosing, ritual: 'unknown' })));
assert.throws(() => parseState(JSON.stringify({ ...midClosing, records: [midClosing.records[0], midClosing.records[0]] })));
assert.throws(() => parseState(JSON.stringify({ ...s, active: { ...s.active, elapsedMs: -1 } })));
assert.throws(() => beginSession(newState(), { minutes: 0, station: '', id: 'invalid', now: start }));
console.log('PASS: timestamp timing, pause/recovery, short closing, idempotence, memory persistence and import validation');
