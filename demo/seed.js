// Demo data seeder for ShipSure. Run in the browser console of the Jira developer site (same-origin, uses the
// signed-in session). Creates project ORBIT ("Orbit Mobile App") with releases 2.3.0 (released), 2.4.0 (target)
// and 2.5.0, plus realistic issues, statuses, priorities, assignees and "blocks" links.
(async () => {
  const H = { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Atlassian-Token': 'no-check' };
  const call = async (method, path, body) => {
    const r = await fetch(path, { method, headers: H, body: body ? JSON.stringify(body) : undefined, credentials: 'include' });
    const t = await r.text();
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t.slice(0, 300)}`);
    return t ? JSON.parse(t) : null;
  };
  const log = [];
  const me = await call('GET', '/rest/api/3/myself');
  const KEY = 'ORBIT';
  let project;
  try {
    project = await call('GET', `/rest/api/3/project/${KEY}`);
    log.push('project exists');
  } catch {
    project = await call('POST', '/rest/api/3/project', {
      key: KEY, name: 'Orbit Mobile App', projectTypeKey: 'software', leadAccountId: me.accountId,
      projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-simplified-scrum-classic', assigneeType: 'UNASSIGNED',
      description: 'Demo project for ShipSure (release readiness).',
    });
    project = await call('GET', `/rest/api/3/project/${KEY}`);
    log.push('project created');
  }
  const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  const existing = await call('GET', `/rest/api/3/project/${KEY}/versions`);
  const ver = {};
  for (const [name, releaseDate, released] of [['2.3.0', day(-21), true], ['2.4.0', day(6), false], ['2.5.0', day(34), false]]) {
    ver[name] = existing.find((v) => v.name === name) || await call('POST', '/rest/api/3/version', { name, projectId: Number(project.id), releaseDate, released });
  }
  const types = Object.fromEntries((project.issueTypes || []).map((t) => [t.name.toLowerCase(), t.id]));
  const typeId = (n) => types[n.toLowerCase()] || types.task || Object.values(types)[0];
  // [summary, type, priority, version, targetStatusCategory, assignToMe, key alias]
  const plan = [
    ['Offline mode for saved trips', 'Story', 'High', '2.4.0', 'done', true, 'offline'],
    ['Push notification preferences screen', 'Story', 'Medium', '2.4.0', 'done', true],
    ['Dark mode for map view', 'Story', 'Medium', '2.4.0', 'done', true],
    ['Crash when rotating device on trip summary', 'Bug', 'High', '2.4.0', 'done', true],
    ['Upgrade payments SDK to v5', 'Task', 'High', '2.4.0', 'indeterminate', true, 'sdk'],
    ['Apple Pay checkout', 'Story', 'High', '2.4.0', 'indeterminate', true, 'applepay'],
    ['Payment fails on 3-D Secure cards', 'Bug', 'Highest', '2.4.0', 'new', true, 'threeds'],
    ['Login loop after password reset', 'Bug', 'High', '2.4.0', 'indeterminate', true, 'loginloop'],
    ['Localize onboarding into Spanish and German', 'Task', 'Medium', '2.4.0', 'indeterminate', true],
    ['Trip sharing deep links', 'Story', 'Medium', '2.4.0', 'new', false, 'deeplinks'],
    ['Update privacy policy screen', 'Task', 'Low', '2.4.0', 'new', false],
    ['Accessibility labels on booking flow', 'Task', 'Medium', '2.4.0', 'done', true],
    ['Reduce cold start time below 2s', 'Task', 'Medium', '2.4.0', 'done', true],
    ['App store screenshots for 2.4', 'Task', 'Low', '2.4.0', 'new', true],
    ['Backend: deep link resolver endpoint', 'Task', 'High', '2.5.0', 'indeterminate', true, 'resolver'],
    ['Widgets for upcoming trips', 'Story', 'Medium', '2.5.0', 'new', false],
    ['Release 2.3.0 hotfix: map tiles', 'Bug', 'High', '2.3.0', 'done', true],
  ];
  const created = {};
  const have = await call('POST', '/rest/api/3/search/jql', { jql: `project = ${KEY}`, fields: ['summary'], maxResults: 100 });
  const bySummary = Object.fromEntries((have.issues || []).map((i) => [i.fields.summary, i.key]));
  for (const [summary, type, priority, version, cat, mine, alias] of plan) {
    let key = bySummary[summary];
    if (!key) {
      const fields = { project: { key: KEY }, summary, issuetype: { id: typeId(type) }, fixVersions: [{ id: ver[version].id }],
        description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: `${type} planned for ${version}.` }] }] } };
      try { fields.priority = { name: priority }; } catch {}
      if (mine) fields.assignee = { accountId: me.accountId };
      try {
        key = (await call('POST', '/rest/api/3/issue', { fields })).key;
      } catch (e) {
        delete fields.priority; // some templates hide priority
        key = (await call('POST', '/rest/api/3/issue', { fields })).key;
      }
      // move to the target status category
      if (cat !== 'new') {
        const tr = await call('GET', `/rest/api/3/issue/${key}/transitions`);
        const want = (t) => t.to?.statusCategory?.key === cat;
        const t = tr.transitions.find(want);
        if (t) await call('POST', `/rest/api/3/issue/${key}/transitions`, { transition: { id: t.id } });
      }
    }
    created[alias || summary] = key;
  }
  // blocks links: [blocker, blocked]
  for (const [blocker, blocked] of [['sdk', 'applepay'], ['resolver', 'deeplinks']]) {
    try {
      // Jira semantics: inwardIssue <outward verb> outwardIssue, i.e. "blocker blocks blocked"
      await call('POST', '/rest/api/3/issueLink', { type: { name: 'Blocks' }, inwardIssue: { key: created[blocker] }, outwardIssue: { key: created[blocked] } });
    } catch (e) { log.push('link: ' + e.message); }
  }
  const check = await call('GET', `/rest/api/3/issue/${created.applepay}?fields=issuelinks`);
  log.push('applepay links: ' + JSON.stringify(check.fields.issuelinks.map((l) => ({ inward: l.type.inward, outward: l.type.outward, inwardIssue: l.inwardIssue?.key, outwardIssue: l.outwardIssue?.key }))));
  window.__shipsureSeed = { created, versions: Object.fromEntries(Object.entries(ver).map(([k, v]) => [k, v.id])), log };
  return window.__shipsureSeed;
})();
