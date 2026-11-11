// Rovo actions. The same handlers are exposed to the ShipSure agent and, via rovo:mcp, as MCP tools.
import { addComment, issuesFor, listVersions, notesFor, readinessFor } from './lib/jira';

function projectFrom(payload) {
  return payload?.projectKey || payload?.context?.jira?.projectKey || payload?.context?.jira?.project?.key || null;
}

async function safely(fn) {
  try {
    return await fn();
  } catch (e) {
    return `ShipSure could not complete this: ${e.message}`;
  }
}

export async function getVersions(payload) {
  return safely(async () => {
    const key = projectFrom(payload);
    if (!key) return 'Tell me which Jira project (key, for example SHIP) to look at.';
    const versions = (await listVersions(key)).filter((v) => !v.archived);
    if (!versions.length) return `Project ${key} has no releases yet.`;
    return `Releases in ${key}:\n` + versions.map((v) => `- ${v.name}${v.released ? ' (released)' : ''}${v.releaseDate ? `, date ${v.releaseDate}` : ''}`).join('\n');
  });
}

export async function getReadiness(payload) {
  return safely(async () => {
    const r = await readinessFor(projectFrom(payload), payload?.version);
    return r.text + `\n\n(Data: ${JSON.stringify({ score: r.score, verdict: r.verdict, counts: r.counts })})`;
  });
}

export async function getBlockers(payload) {
  return safely(async () => {
    const r = await readinessFor(projectFrom(payload), payload?.version);
    if (!r.risks.length) return `No blockers or risks found for ${r.version.name}. ${r.counts.total - r.counts.done} issue(s) still open.`;
    return `Risks for ${r.version.name}, most severe first:\n` + r.risks.map((x) => `- ${x.text}`).join('\n');
  });
}

export async function getReleaseNotes(payload) {
  return safely(() => notesFor(projectFrom(payload), payload?.version));
}

export async function getReleaseIssues(payload) {
  return safely(async () => {
    const { version, issues } = await issuesFor(projectFrom(payload), payload?.version);
    return `${issues.length} issue(s) in ${version.name}:\n` + issues.map((i) => `- ${i.key} [${i.type}, ${i.priority}] ${i.summary}: ${i.status}${i.assignee ? `, ${i.assignee}` : ', unassigned'}`).join('\n');
  });
}

export async function postReadiness(payload) {
  return safely(async () => {
    const issueKey = payload?.issueKey || payload?.context?.jira?.issueKey;
    if (!issueKey) return 'Which issue should I post the readiness report on? Give me an issue key.';
    const project = projectFrom(payload) || String(issueKey).split('-')[0];
    const r = await readinessFor(project, payload?.version);
    await addComment(issueKey, `ShipSure readiness report\n${r.text}`);
    return `Posted the readiness report for ${r.version.name} (${r.score}/100, ${r.verdict}) as a comment on ${issueKey}.`;
  });
}
