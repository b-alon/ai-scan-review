import { Alert, Badge, Group, Paper, Stack, Text, Title, Tooltip } from '@mantine/core';
import { formatDuration } from '../lib/format';
import type { ScanView } from '../types';
import { ComparisonSection } from './ComparisonSection';
import { FindingsTable } from './FindingsTable';
import { NextActions } from './NextActions';
import { RiskBadge } from './RiskBadge';
import { TopRisks } from './TopRisks';

export function ScanResult({ view }: { view: ScanView }) {
  const summary = view.summary;
  const findings = view.findings ?? [];
  if (!summary) return <Alert color="red">This scan finished without a summary.</Alert>;
  return (
    <Stack gap="xl">
      <Group gap="sm">
        <RiskBadge risk={summary.riskLevel} />
        <Tooltip label={view.summarizerNote ?? (view.summarizer === 'claude' ? 'Written by Claude from the scan findings' : 'Produced by deterministic rules')} withArrow>
          <Badge variant="outline" color={view.summarizer === 'claude' ? 'grape' : 'gray'}>
            {view.summarizer === 'claude' ? 'AI summary' : 'Rule-based summary'}
          </Badge>
        </Tooltip>
        {view.stats.totalMs !== undefined && (
          <Text size="sm" c="dimmed">
            {view.stats.files ?? 0} files · {view.stats.packages ?? 0} packages · {formatDuration(view.stats.totalMs)}
          </Text>
        )}
      </Group>

      {view.warnings.map((w) => (
        <Alert key={w.code} color="yellow" title="Heads up">
          {w.message}
        </Alert>
      ))}

      <Stack gap="sm">
        <Title order={3}>What matters</Title>
        <Paper withBorder radius="md" p="lg">
          <Stack gap="xs">
            <Title order={4}>{summary.headline}</Title>
            <Text>{summary.overview}</Text>
          </Stack>
        </Paper>
      </Stack>

      <Stack gap="sm">
        <Title order={3}>What is risky</Title>
        <TopRisks risks={summary.topRisks} findings={findings} />
      </Stack>

      <Stack gap="sm">
        <Title order={3}>What to do next</Title>
        <NextActions actions={summary.nextActions} findings={findings} />
      </Stack>

      {view.comparison && <ComparisonSection comparison={view.comparison} previousFinishedAgo={null} />}

      <Stack gap="sm">
        <Title order={3}>All findings</Title>
        {findings.length === 0 ? <Text c="dimmed">No findings.</Text> : <FindingsTable findings={findings} />}
      </Stack>
    </Stack>
  );
}
