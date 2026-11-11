import Resolver from '@forge/resolver';
import { listVersions, notesFor, readinessFor, addComment } from './lib/jira';

const resolver = new Resolver();

const projectOf = (context, payload) => payload?.projectKey || context?.extension?.project?.key;

resolver.define('getVersions', async ({ payload, context }) => {
  const key = projectOf(context, payload);
  return { projectKey: key, versions: (await listVersions(key)).filter((v) => !v.archived) };
});

resolver.define('getReadiness', async ({ payload, context }) => {
  try {
    return { ok: true, report: await readinessFor(projectOf(context, payload), payload?.version) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

resolver.define('getNotes', async ({ payload, context }) => {
  try {
    return { ok: true, notes: await notesFor(projectOf(context, payload), payload?.version) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

resolver.define('postComment', async ({ payload }) => {
  try {
    await addComment(payload.issueKey, payload.text);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

export const handler = resolver.getDefinitions();
export * from './actions';
