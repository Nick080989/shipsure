import api, { route } from '@forge/api';
import { computeReadiness, draftReleaseNotes, pickVersion, readinessText, simplify } from './readiness';

const FIELDS = ['summary', 'status', 'issuetype', 'priority', 'assignee', 'updated', 'issuelinks', 'resolution'];

async function jira(path, opts = {}) {
  const res = await api.asUser().requestJira(path, { headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Jira API ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

export async function listProjects() {
  const data = await jira(route`/rest/api/3/project/search?maxResults=50&orderBy=name`);
  return (data.values || []).map((p) => ({ key: p.key, name: p.name }));
}

export async function listVersions(projectKey) {
  const versions = await jira(route`/rest/api/3/project/${projectKey}/versions`);
  return versions.map((v) => ({ id: v.id, name: v.name, releaseDate: v.releaseDate || null, released: !!v.released, archived: !!v.archived }));
}

export async function searchAll(jql, max = 500) {
  const issues = [];
  let nextPageToken;
  do {
    const body = { jql, fields: FIELDS, maxResults: 100 };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const data = await jira(route`/rest/api/3/search/jql`, { method: 'POST', body: JSON.stringify(body) });
    issues.push(...(data.issues || []));
    nextPageToken = data.nextPageToken;
  } while (nextPageToken && issues.length < max);
  return issues;
}

const jqlString = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

/** Resolve project + version, then fetch the release's issues. */
export async function loadRelease(projectKey, versionName) {
  if (!projectKey) throw new Error('A Jira project key is required (for example SHIP).');
  const key = String(projectKey).trim().toUpperCase();
  const versions = await listVersions(key);
  const version = pickVersion(versions, versionName);
  if (!version) throw new Error(`Project ${key} has no versions (releases). Create one under Releases, or name an existing one.`);
  const issues = await searchAll(`project = ${jqlString(key)} AND fixVersion = ${version.id} ORDER BY priority DESC, updated DESC`);
  return { projectKey: key, version, versions, issues };
}

export async function readinessFor(projectKey, versionName) {
  const { projectKey: key, version, issues } = await loadRelease(projectKey, versionName);
  const report = computeReadiness(issues, version);
  return { projectKey: key, ...report, text: readinessText(report) };
}

export async function notesFor(projectKey, versionName) {
  const { version, issues } = await loadRelease(projectKey, versionName);
  return draftReleaseNotes(issues, version);
}

export async function issuesFor(projectKey, versionName) {
  const { version, issues } = await loadRelease(projectKey, versionName);
  return { version, issues: issues.map(simplify) };
}

export async function addComment(issueKey, text) {
  // Atlassian Document Format: one paragraph per line
  const content = String(text).split('\n').map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] }));
  await jira(route`/rest/api/3/issue/${issueKey}/comment`, { method: 'POST', body: JSON.stringify({ body: { type: 'doc', version: 1, content } }) });
  return true;
}
