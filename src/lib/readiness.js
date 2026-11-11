// Pure release-readiness logic (no Forge imports, unit-testable with plain Node).

const DAY = 24 * 60 * 60 * 1000;
export const STALE_DAYS = 5;
const HIGH_PRIORITIES = new Set(['highest', 'high', 'critical', 'blocker', 'urgent']);
const FEATURE_TYPES = new Set(['story', 'new feature', 'feature', 'epic']);
const BUG_TYPES = new Set(['bug', 'defect', 'incident']);

const cat = (issue) => issue?.fields?.status?.statusCategory?.key || 'new'; // new | indeterminate | done
const isDone = (issue) => cat(issue) === 'done';
const lower = (s) => String(s || '').toLowerCase();

export function simplify(issue) {
  const f = issue.fields || {};
  return {
    key: issue.key,
    summary: f.summary || '',
    type: f.issuetype?.name || 'Task',
    status: f.status?.name || '',
    statusCategory: cat(issue),
    priority: f.priority?.name || '',
    assignee: f.assignee?.displayName || null,
    updated: f.updated || null,
  };
}

/** Issues in the release that are blocked by unresolved work (inside or outside the release). */
export function findBlockers(issues) {
  const out = [];
  for (const issue of issues) {
    if (isDone(issue)) continue;
    for (const link of issue.fields?.issuelinks || []) {
      const inward = lower(link.type?.inward);
      const other = link.inwardIssue;
      if (other && inward.includes('blocked by') && cat(other) !== 'done') {
        out.push({
          issue: simplify(issue),
          blockedBy: { key: other.key, summary: other.fields?.summary || '', status: other.fields?.status?.name || '' },
        });
      }
    }
  }
  return out;
}

export function computeReadiness(issues, version = {}, now = Date.now()) {
  const total = issues.length;
  const done = issues.filter(isDone);
  const open = issues.filter((i) => !isDone(i));
  const inProgress = open.filter((i) => cat(i) === 'indeterminate');
  const blockers = findBlockers(issues);
  const critical = open.filter((i) => BUG_TYPES.has(lower(i.fields?.issuetype?.name)) && HIGH_PRIORITIES.has(lower(i.fields?.priority?.name)));
  const stale = inProgress.filter((i) => i.fields?.updated && now - Date.parse(i.fields.updated) > STALE_DAYS * DAY);
  const unassigned = open.filter((i) => !i.fields?.assignee);

  const doneRatio = total ? done.length / total : 0;
  const penalties = [
    { reason: 'blocked issues', count: blockers.length, each: 8, max: 40 },
    { reason: 'high-priority open bugs', count: critical.length, each: 6, max: 30 },
    { reason: `issues in progress with no update for ${STALE_DAYS}+ days`, count: stale.length, each: 3, max: 15 },
    { reason: 'unassigned open issues', count: unassigned.length, each: 2, max: 10 },
  ].map((p) => ({ ...p, points: Math.min(p.max, p.count * p.each) }));

  let releaseDate = version.releaseDate || null;
  let daysLeft = null;
  let overdue = false;
  if (releaseDate) {
    daysLeft = Math.ceil((Date.parse(releaseDate + 'T23:59:59Z') - now) / DAY);
    overdue = daysLeft < 0 && !version.released;
    if (overdue) penalties.push({ reason: 'release date has passed', count: 1, each: 10, max: 10, points: 10 });
  }
  const base = 40 + 60 * doneRatio;
  const lost = penalties.reduce((a, p) => a + p.points, 0);
  const score = total ? Math.max(0, Math.min(100, Math.round(base - lost))) : 0;
  const verdict = !total ? 'No issues in this release' : score >= 85 && blockers.length === 0 ? 'Ready to ship' : score >= 65 ? 'Ship with caution' : 'Not ready';

  // ranked risks, most severe first
  const risks = [];
  for (const b of blockers) risks.push({ severity: 3, key: b.issue.key, text: `${b.issue.key} "${b.issue.summary}" is blocked by ${b.blockedBy.key} (${b.blockedBy.status})` });
  for (const i of critical) risks.push({ severity: 2, key: i.key, text: `${i.key} "${i.fields.summary}" is a ${i.fields.priority?.name} priority bug still ${i.fields.status?.name}` });
  for (const i of stale) {
    const d = Math.floor((now - Date.parse(i.fields.updated)) / DAY);
    risks.push({ severity: 1, key: i.key, text: `${i.key} "${i.fields.summary}" has been ${i.fields.status?.name} with no update for ${d} days` });
  }
  for (const i of unassigned) risks.push({ severity: 1, key: i.key, text: `${i.key} "${i.fields.summary}" has no assignee` });
  const seen = new Set();
  const ranked = risks.sort((a, b) => b.severity - a.severity).filter((r) => (seen.has(r.text) ? false : seen.add(r.text)));

  const nextSteps = [];
  if (blockers.length) nextSteps.push(`Unblock ${blockers.length} issue(s): start with ${blockers[0].blockedBy.key}.`);
  if (critical.length) nextSteps.push(`Fix or explicitly defer ${critical.length} high-priority bug(s).`);
  if (stale.length) nextSteps.push(`Check in on ${stale.length} stalled issue(s) or move them out of the release.`);
  if (unassigned.length) nextSteps.push(`Assign owners to ${unassigned.length} open issue(s).`);
  if (overdue) nextSteps.push('Move the release date or cut scope: the planned date has passed.');
  if (!nextSteps.length && total) nextSteps.push(open.length ? `Finish the remaining ${open.length} issue(s).` : 'Everything is done: release it!');

  return {
    version: { name: version.name || null, releaseDate, released: !!version.released, daysLeft, overdue },
    score, verdict,
    counts: { total, done: done.length, inProgress: inProgress.length, todo: open.length - inProgress.length, blocked: blockers.length, critical: critical.length, stale: stale.length, unassigned: unassigned.length },
    penalties: penalties.filter((p) => p.points > 0),
    blockers, risks: ranked.slice(0, 15), nextSteps,
  };
}

export function readinessText(r) {
  const v = r.version.name ? `Release ${r.version.name}` : 'This release';
  const when = r.version.releaseDate
    ? r.version.overdue ? ` (planned ${r.version.releaseDate}, ${-r.version.daysLeft} day(s) overdue)` : ` (planned ${r.version.releaseDate}, ${r.version.daysLeft} day(s) left)`
    : '';
  const c = r.counts;
  const lines = [
    `${v}${when}: readiness ${r.score}/100, ${r.verdict}.`,
    `${c.done}/${c.total} issues done, ${c.inProgress} in progress, ${c.todo} to do. ${c.blocked} blocked, ${c.critical} high-priority bugs open, ${c.stale} stalled, ${c.unassigned} unassigned.`,
  ];
  if (r.risks.length) lines.push('Top risks:', ...r.risks.slice(0, 6).map((x) => `- ${x.text}`));
  if (r.nextSteps.length) lines.push('Next steps:', ...r.nextSteps.map((x) => `- ${x}`));
  return lines.join('\n');
}

export function draftReleaseNotes(issues, version = {}) {
  const done = issues.filter(isDone).map(simplify);
  const groups = { 'New features': [], 'Bug fixes': [], Improvements: [] };
  for (const i of done) {
    const t = lower(i.type);
    (FEATURE_TYPES.has(t) ? groups['New features'] : BUG_TYPES.has(t) ? groups['Bug fixes'] : groups.Improvements).push(i);
  }
  const notDone = issues.filter((i) => !isDone(i)).map(simplify);
  const lines = [`# Release notes: ${version.name || 'upcoming release'}`];
  if (version.releaseDate) lines.push(`Planned release date: ${version.releaseDate}`);
  for (const [title, list] of Object.entries(groups)) {
    if (!list.length) continue;
    lines.push('', `## ${title}`, ...list.map((i) => `- ${i.summary} (${i.key})`));
  }
  if (!done.length) lines.push('', 'No completed issues yet.');
  if (notDone.length) lines.push('', `_Not included: ${notDone.length} unfinished issue(s): ${notDone.slice(0, 8).map((i) => i.key).join(', ')}${notDone.length > 8 ? ', ...' : ''}._`);
  return lines.join('\n');
}

/** Choose the version to analyse: by name (case-insensitive), else the nearest unreleased one. */
export function pickVersion(versions, name) {
  const list = (versions || []).filter((v) => !v.archived);
  if (name) {
    const n = lower(name).replace(/^v(?=\d)/, '');
    const hit = list.find((v) => lower(v.name) === lower(name)) || list.find((v) => lower(v.name).replace(/^v(?=\d)/, '') === n);
    if (hit) return hit;
  }
  const unreleased = list.filter((v) => !v.released);
  unreleased.sort((a, b) => (a.releaseDate || '9999').localeCompare(b.releaseDate || '9999'));
  return unreleased[0] || list[list.length - 1] || null;
}
