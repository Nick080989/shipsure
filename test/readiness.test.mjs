import test from 'node:test';
import assert from 'node:assert/strict';
import { computeReadiness, draftReleaseNotes, pickVersion, readinessText, findBlockers } from '../src/lib/readiness.js';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();
let n = 0;
function issue({ type = 'Story', status = 'To Do', cat = 'new', priority = 'Medium', assignee = 'Ana', updated = daysAgo(1), links = [], summary } = {}) {
  n += 1;
  return {
    key: `SHIP-${n}`,
    fields: {
      summary: summary || `Issue ${n}`, issuetype: { name: type }, status: { name: status, statusCategory: { key: cat } },
      priority: { name: priority }, assignee: assignee ? { displayName: assignee } : null, updated, issuelinks: links,
    },
  };
}
const blockedBy = (key, cat = 'indeterminate') => ({ type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, inwardIssue: { key, fields: { summary: 'dep', status: { name: 'In Progress', statusCategory: { key: cat } } } } });

test('all done, no risks -> ready, 100', () => {
  const issues = [issue({ cat: 'done', status: 'Done' }), issue({ cat: 'done', status: 'Done', type: 'Bug' })];
  const r = computeReadiness(issues, { name: '1.0', releaseDate: '2026-11-25' }, NOW);
  assert.equal(r.score, 100);
  assert.equal(r.verdict, 'Ready to ship');
  assert.equal(r.version.daysLeft, 6);
  assert.match(r.nextSteps[0], /release it/);
});

test('blockers, critical bugs, stale and unassigned are detected and penalised', () => {
  const issues = [
    issue({ cat: 'done', status: 'Done' }),
    issue({ cat: 'done', status: 'Done' }),
    issue({ cat: 'indeterminate', status: 'In Progress', links: [blockedBy('API-7')] }),
    issue({ type: 'Bug', priority: 'Highest', status: 'To Do' }),
    issue({ cat: 'indeterminate', status: 'In Review', updated: daysAgo(9) }),
    issue({ assignee: null }),
    issue({ cat: 'indeterminate', links: [blockedBy('API-8', 'done')] }), // resolved blocker: not a risk
  ];
  const r = computeReadiness(issues, { name: '2.0', releaseDate: '2026-11-22' }, NOW);
  assert.deepEqual([r.counts.blocked, r.counts.critical, r.counts.stale, r.counts.unassigned], [1, 1, 1, 1]);
  // base 40 + 60*2/7 = 57.14 ; minus 8+6+3+2 = 19 -> 38
  assert.equal(r.score, 38);
  assert.equal(r.verdict, 'Not ready');
  assert.equal(r.risks[0].severity, 3);
  assert.match(r.risks[0].text, /blocked by API-7/);
  assert.match(r.nextSteps[0], /API-7/);
  const txt = readinessText(r);
  assert.match(txt, /readiness 38\/100, Not ready/);
  assert.match(txt, /3 day\(s\) left/);
});

test('overdue release is penalised and reported', () => {
  const issues = [issue({ cat: 'done' }), issue({ cat: 'indeterminate' })];
  const r = computeReadiness(issues, { name: '0.9', releaseDate: '2026-11-15', released: false }, NOW);
  assert.equal(r.version.overdue, true);
  assert.ok(r.penalties.some((p) => /passed/.test(p.reason)));
  assert.match(readinessText(r), /overdue/);
});

test('empty release', () => {
  const r = computeReadiness([], { name: 'x' }, NOW);
  assert.equal(r.score, 0);
  assert.equal(r.verdict, 'No issues in this release');
});

test('release notes group completed work and list leftovers', () => {
  const issues = [
    issue({ cat: 'done', type: 'Story', summary: 'Dark mode' }),
    issue({ cat: 'done', type: 'Bug', summary: 'Crash on login' }),
    issue({ cat: 'done', type: 'Task', summary: 'Upgrade deps' }),
    issue({ cat: 'new', summary: 'Not finished' }),
  ];
  const md = draftReleaseNotes(issues, { name: '3.1', releaseDate: '2026-12-01' });
  assert.match(md, /## New features\n- Dark mode/);
  assert.match(md, /## Bug fixes\n- Crash on login/);
  assert.match(md, /## Improvements\n- Upgrade deps/);
  assert.match(md, /Not included: 1 unfinished/);
});

test('pickVersion: by name, v-prefix tolerant, else nearest unreleased', () => {
  const vs = [
    { name: '1.0', released: true, releaseDate: '2026-10-01' },
    { name: '2.1', released: false, releaseDate: '2026-12-15' },
    { name: '2.0', released: false, releaseDate: '2026-11-30' },
    { name: 'old', archived: true },
  ];
  assert.equal(pickVersion(vs, 'v2.1').name, '2.1');
  assert.equal(pickVersion(vs, '1.0').name, '1.0');
  assert.equal(pickVersion(vs).name, '2.0');
  assert.equal(pickVersion([], 'x'), null);
});

test('findBlockers ignores done issues', () => {
  const issues = [issue({ cat: 'done', links: [blockedBy('X-1')] })];
  assert.equal(findBlockers(issues).length, 0);
});
