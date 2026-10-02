// Session time follows timestamps, not the number of timer callbacks.
export const SAVE_KEY = 'foxkin.companion.v1';
const PHASES = ['running', 'paused', 'closing', 'recovery'];
const RITUALS = [null, 'head', 'nose'];
const GREETINGS = ['familiar', 'wink', 'smile'];
const SOUNDS = ['off', 'chime'];
const OUTCOMES = ['', 'done', 'some', 'rest'];
const amount = (x) => Number.isSafeInteger(x) && x >= 0;
const date = (x) => amount(x) && x <= 8640000000000000;
const text = (x, limit) => typeof x === 'string' && x.length <= limit;

export function newState() {
  return { version: 2, name: '小狐', ritual: null, greeting: 'familiar', closingSound: 'off',
    events: { welcome: false, sound: false, lastDay: null }, pendingEvent: null,
    quiet: false, volume: 0.65, active: null, records: [] };
}

export function localDay(time) {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function validDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

export function togetherDays(state) {
  return new Set(state.records.map((r) => r.day)).size;
}

function offerEvent(state, day) {
  if (state.pendingEvent || state.events.lastDay === day) return;
  const days = togetherDays(state);
  if (days >= 3 && !state.events.welcome) state.pendingEvent = 'welcome';
  else if (days >= 7 && !state.events.sound) state.pendingEvent = 'sound';
  if (state.pendingEvent) state.events.lastDay = day;
}

export function chooseEvent(state, choice, now = Date.now()) {
  const kind = state.pendingEvent;
  if (!kind) return false;
  if (!(kind === 'welcome' ? GREETINGS : SOUNDS).includes(choice)) throw new Error('请选择有效的习惯。');
  if (kind === 'welcome') state.greeting = choice;
  else state.closingSound = choice;
  state.events[kind] = true;
  // A deferred choice also occupies today's event slot; no second story immediately follows it.
  state.events.lastDay = localDay(now);
  state.pendingEvent = null;
  return true;
}

// Copy known fields only. Invalid imports never replace a working save.
export function parseState(raw) {
  const s = JSON.parse(raw);
  if (!s || ![1, 2].includes(s.version) || !text(s.name, 12) || !s.name.trim() ||
      !RITUALS.includes(s.ritual) || typeof s.quiet !== 'boolean' ||
      typeof s.volume !== 'number' || !Number.isFinite(s.volume) || s.volume < 0 || s.volume > 1 || !Array.isArray(s.records)) {
    throw new Error('这份存档的格式或版本不受支持。');
  }
  const records = s.records.map((r) => {
    if (!r || !text(r.id, 80) || !r.id || !date(r.startedAt) || !date(r.endedAt) ||
        r.endedAt < r.startedAt || !amount(r.elapsedMs) || !text(r.intent, 100) ||
        !text(r.station, 40) || !OUTCOMES.includes(r.outcome) || !RITUALS.includes(r.ritual)) {
      throw new Error('共同经历记录不完整，原存档已保留。');
    }
    // v1 did not capture the local date. Derive it once at migration; v2 keeps it across time zones.
    const day = s.version === 1 ? localDay(r.endedAt) : r.day;
    const closingSound = s.version === 1 ? 'off' : r.closingSound;
    if (!validDay(day) || !SOUNDS.includes(closingSound)) throw new Error('经历中的日期或声音格式有误。');
    return { id: r.id, startedAt: r.startedAt, endedAt: r.endedAt, elapsedMs: r.elapsedMs,
      intent: r.intent, station: r.station, outcome: r.outcome, ritual: r.ritual, day, closingSound };
  });
  const ids = new Set(records.map((r) => r.id));
  if (ids.size !== records.length) throw new Error('存档包含重复的经历。');
  let active = null;
  if (s.active !== null) {
    const a = s.active;
    if (!a || !text(a.id, 80) || !a.id || ids.has(a.id) || !date(a.startedAt) ||
        !date(a.lastSeenAt) || a.lastSeenAt < a.startedAt || !amount(a.elapsedMs) ||
        !amount(a.plannedMs) || !a.plannedMs || !PHASES.includes(a.phase) ||
        !text(a.intent, 100) || !text(a.station, 40) ||
        (a.phase === 'running' ? !date(a.runningSince) || a.runningSince < a.startedAt || a.runningSince > a.lastSeenAt : a.runningSince !== null)) {
      throw new Error('陪伴会话格式有误，原存档已保留。');
    }
    active = { id: a.id, startedAt: a.startedAt, lastSeenAt: a.lastSeenAt,
      elapsedMs: a.elapsedMs, plannedMs: a.plannedMs, runningSince: a.runningSince,
      phase: a.phase, intent: a.intent, station: a.station };
  }
  let greeting = 'familiar', closingSound = 'off', pendingEvent = null;
  let events = { welcome: false, sound: false, lastDay: null };
  if (s.version === 2) {
    if (!GREETINGS.includes(s.greeting) || !SOUNDS.includes(s.closingSound) ||
        !s.events || typeof s.events.welcome !== 'boolean' || typeof s.events.sound !== 'boolean' ||
        (s.events.lastDay !== null && !validDay(s.events.lastDay)) ||
        ![null, 'welcome', 'sound'].includes(s.pendingEvent)) throw new Error('习惯存档格式有误。');
    greeting = s.greeting; closingSound = s.closingSound; pendingEvent = s.pendingEvent;
    events = { welcome: s.events.welcome, sound: s.events.sound, lastDay: s.events.lastDay };
    const days = new Set(records.map((r) => r.day)).size;
    if ((events.welcome && days < 3) || (events.sound && (days < 7 || !events.welcome)) ||
        (pendingEvent === 'welcome' && (days < 3 || events.welcome)) ||
        (pendingEvent === 'sound' && (days < 7 || !events.welcome || events.sound)) ||
        (pendingEvent && !events.lastDay)) throw new Error('关系节点与经历不一致。');
  }
  return { version: 2, name: s.name.trim(), ritual: s.ritual, greeting, closingSound, events, pendingEvent,
    quiet: s.quiet, volume: s.volume, active, records };
}

export function elapsed(session, now = Date.now()) {
  if (!session) return 0;
  return session.elapsedMs + (session.phase === 'running' ? Math.max(0, now - session.runningSince) : 0);
}

export function beginSession(state, { minutes, intent = '', station, id, now = Date.now() }) {
  if (state.active) return false;
  if (![10, 25, 45].includes(minutes) || !text(intent, 100) || !text(station, 40) ||
      !text(id, 80) || !id || state.records.some((r) => r.id === id) || !date(now)) {
    throw new Error('无法开始这段陪伴。');
  }
  state.active = { id, startedAt: now, lastSeenAt: now, elapsedMs: 0,
    plannedMs: minutes * 60000, runningSince: now, phase: 'running', intent: intent.trim(), station };
  return true;
}

export function checkpoint(state, now = Date.now()) {
  const a = state.active;
  if (!a) return;
  // A backwards clock adjustment must not reduce an already saved duration.
  now = Math.max(now, a.lastSeenAt);
  a.elapsedMs = elapsed(a, now);
  a.lastSeenAt = now;
  if (a.phase === 'running') a.runningSince = now;
}

export function pauseSession(state, phase = 'paused', now = Date.now()) {
  if (!state.active || !['paused', 'closing'].includes(phase)) return;
  checkpoint(state, now);
  state.active.runningSince = null;
  state.active.phase = phase;
}

export function recoverSession(state) {
  const a = state.active;
  if (a?.phase !== 'running') return;
  // No relationship progress or unobserved time is generated while closed/asleep.
  a.elapsedMs = elapsed(a, a.lastSeenAt);
  a.runningSince = null;
  a.phase = 'recovery';
}

export function resumeSession(state, now = Date.now()) {
  const a = state.active;
  if (!a || !['paused', 'recovery'].includes(a.phase)) return false;
  a.runningSince = a.lastSeenAt = Math.max(now, a.lastSeenAt);
  a.phase = 'running';
  return true;
}

export function finishSession(state, ritual, outcome = '', now = Date.now()) {
  const a = state.active;
  if (!a || a.phase !== 'closing') return null;
  if (!RITUALS.includes(ritual) || !OUTCOMES.includes(outcome)) throw new Error('请选择有效的收工方式。');
  const record = { id: a.id, startedAt: a.startedAt, endedAt: Math.max(now, a.lastSeenAt),
    elapsedMs: elapsed(a, now), intent: a.intent, station: a.station, outcome, ritual,
    day: localDay(Math.max(now, a.lastSeenAt)),
    closingSound: ritual && !state.quiet && state.volume > 0 ? state.closingSound : 'off' };
  if (!state.records.some((r) => r.id === a.id)) state.records.push(record);
  if (ritual) state.ritual = ritual;
  state.active = null;
  offerEvent(state, record.day);
  return record;
}
