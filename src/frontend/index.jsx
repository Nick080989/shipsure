import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Stack, Inline, Heading, Text, Strong, Lozenge, Badge, Button, Select, Spinner,
  SectionMessage, DynamicTable, ProgressBar, Link, useProductContext,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const verdictAppearance = (v) => (v === 'Ready to ship' ? 'success' : v === 'Ship with caution' ? 'moved' : v === 'Not ready' ? 'removed' : 'default');
const sevLabel = { 3: ['Blocker', 'removed'], 2: ['Critical', 'moved'], 1: ['Watch', 'default'] };

function Stat({ label, value, appearance }) {
  return (
    <Stack space="space.050" alignInline="center">
      <Badge appearance={appearance || 'default'}>{value}</Badge>
      <Text size="small">{label}</Text>
    </Stack>
  );
}

const App = () => {
  const context = useProductContext();
  const projectKey = context?.extension?.project?.key;
  const [versions, setVersions] = useState(null);
  const [version, setVersion] = useState(null);
  const [report, setReport] = useState(null);
  const [notes, setNotes] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectKey) return;
    invoke('getVersions', { projectKey }).then((r) => {
      setVersions(r.versions);
      const next = r.versions.filter((v) => !v.released).sort((a, b) => (a.releaseDate || '9999').localeCompare(b.releaseDate || '9999'))[0] || r.versions[r.versions.length - 1];
      if (next) setVersion(next.name);
    }).catch((e) => setError(String(e.message || e)));
  }, [projectKey]);

  useEffect(() => {
    if (!projectKey || !version) return;
    setLoading(true); setNotes(null);
    invoke('getReadiness', { projectKey, version }).then((r) => {
      setLoading(false);
      if (r.ok) { setReport(r.report); setError(null); } else setError(r.error);
    });
  }, [projectKey, version]);

  const loadNotes = () => invoke('getNotes', { projectKey, version }).then((r) => setNotes(r.ok ? r.notes : `Error: ${r.error}`));

  if (!projectKey) return <Spinner />;
  if (versions && !versions.length) {
    return (
      <SectionMessage title="No releases yet" appearance="information">
        <Text>ShipSure scores a release (a Jira version). Create a version under Releases and add issues to it with Fix version.</Text>
      </SectionMessage>
    );
  }
  const c = report?.counts;
  return (
    <Stack space="space.200">
      <Inline space="space.200" alignBlock="center" spread="space-between">
        <Heading size="medium">ShipSure: release readiness</Heading>
        {versions && (
          <Box xcss={{ width: '260px' }}>
            <Select
              aria-label="Release"
              options={versions.map((v) => ({ label: `${v.name}${v.released ? ' (released)' : ''}`, value: v.name }))}
              value={version ? { label: version, value: version } : undefined}
              onChange={(o) => setVersion(o.value)}
            />
          </Box>
        )}
      </Inline>
      {error && <SectionMessage appearance="error" title="Something went wrong"><Text>{error}</Text></SectionMessage>}
      {(loading || !report) && !error && <Spinner label="Analysing release" />}
      {report && !loading && (
        <Stack space="space.200">
          <Box xcss={{ padding: 'space.200', borderRadius: 'border.radius', backgroundColor: 'elevation.surface.sunken' }}>
            <Stack space="space.100">
              <Inline space="space.150" alignBlock="center">
                <Heading size="large">{report.score}/100</Heading>
                <Lozenge appearance={verdictAppearance(report.verdict)} isBold>{report.verdict}</Lozenge>
                {report.version.releaseDate && (
                  <Text>
                    {report.version.overdue ? <Strong>{-report.version.daysLeft} day(s) overdue</Strong> : `${report.version.daysLeft} day(s) to ${report.version.releaseDate}`}
                  </Text>
                )}
              </Inline>
              <ProgressBar value={c.total ? c.done / c.total : 0} appearance={report.score >= 85 ? 'success' : 'default'} ariaLabel="Done ratio" />
              <Inline space="space.300">
                <Stat label="done" value={`${c.done}/${c.total}`} appearance="added" />
                <Stat label="in progress" value={c.inProgress} />
                <Stat label="blocked" value={c.blocked} appearance={c.blocked ? 'important' : 'default'} />
                <Stat label="critical bugs" value={c.critical} appearance={c.critical ? 'important' : 'default'} />
                <Stat label="stalled" value={c.stale} />
                <Stat label="unassigned" value={c.unassigned} />
              </Inline>
            </Stack>
          </Box>
          {report.nextSteps.length > 0 && (
            <SectionMessage title="Next steps" appearance={report.verdict === 'Ready to ship' ? 'success' : 'warning'}>
              <Stack space="space.050">{report.nextSteps.map((s, i) => <Text key={i}>{`${i + 1}. ${s}`}</Text>)}</Stack>
            </SectionMessage>
          )}
          <Heading size="small">Risks, most severe first</Heading>
          {report.risks.length ? (
            <DynamicTable
              head={{ cells: [{ key: 'sev', content: 'Severity' }, { key: 'issue', content: 'Issue' }, { key: 'why', content: 'Why it matters' }] }}
              rows={report.risks.map((r, i) => ({
                key: `r${i}`,
                cells: [
                  { key: 'sev', content: <Lozenge appearance={sevLabel[r.severity][1]}>{sevLabel[r.severity][0]}</Lozenge> },
                  { key: 'issue', content: <Link href={`/browse/${r.key}`}>{r.key}</Link> },
                  { key: 'why', content: r.text.replace(/^\S+\s/, '') },
                ],
              }))}
            />
          ) : <Text>No risks found.</Text>}
          {report.penalties.length > 0 && (
            <Text size="small">{`How the score is calculated: 40 + 60 x done ratio, minus ${report.penalties.map((p) => `${p.points} for ${p.count} ${p.reason}`).join(', ')}.`}</Text>
          )}
          <Inline space="space.100">
            <Button onClick={loadNotes}>Draft release notes</Button>
          </Inline>
          {notes && (
            <Box xcss={{ padding: 'space.200', borderRadius: 'border.radius', backgroundColor: 'elevation.surface.sunken' }}>
              <Stack space="space.0">
                {notes.split('\n').filter((l) => l.trim()).map((l, i) => {
                  if (l.startsWith('# ')) return <Heading key={i} size="small">{l.slice(2)}</Heading>;
                  if (l.startsWith('## ')) return <Box key={i} xcss={{ paddingBlockStart: 'space.150' }}><Heading size="xsmall">{l.slice(3)}</Heading></Box>;
                  if (/^_.*_$/.test(l)) return <Box key={i} xcss={{ paddingBlockStart: 'space.150' }}><Text size="small" color="color.text.subtle">{l.slice(1, -1)}</Text></Box>;
                  return <Text key={i}>{l.replace(/^- /, '• ')}</Text>;
                })}
              </Stack>
            </Box>
          )}
          <Text size="small">Tip: ask the ShipSure agent in Rovo things like "Are we ready to ship {report.version.name}?"</Text>
        </Stack>
      )}
    </Stack>
  );
};

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
