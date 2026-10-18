import { Alert, Anchor, Badge, Button, Group, Paper, Skeleton, Stack, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { ReusedBanner } from '../components/ReusedBanner';
import { ScanProgress } from '../components/ScanProgress';
import { useScanStream } from '../hooks/useScanStream';
import { shortSha, timeAgo } from '../lib/format';
import type { ReusedReason, ScanView } from '../types';

function ScanHeader({ view }: { view: ScanView }) {
  const refLabel = view.refResolved?.replace(/^refs\/(heads|tags)\//, '') ?? view.refRequested ?? 'default branch';
  return (
    <Group justify="space-between" align="flex-start">
      <Stack gap={2}>
        <Title order={2}>
          <Anchor component={Link} to={`/repos/${view.repoOwner}/${view.repoName}`} c="inherit" underline="hover">
            {view.repoOwner}/{view.repoName}
          </Anchor>
        </Title>
        <Group gap="xs">
          <Badge variant="outline">{refLabel}</Badge>
          <Anchor href={`${view.repoUrl}/commit/${view.commitSha}`} target="_blank" ff="monospace" size="sm">
            {shortSha(view.commitSha)}
          </Anchor>
          <Text c="dimmed" size="sm">
            {view.finishedAt ? `scanned ${timeAgo(view.finishedAt)}` : `started ${timeAgo(view.createdAt)}`}
          </Text>
        </Group>
      </Stack>
    </Group>
  );
}

function ScanResultBasic({ view }: { view: ScanView }) {
  return (
    <Paper withBorder p="lg" radius="md">
      <Stack gap="xs">
        <Title order={3}>{view.summary?.headline}</Title>
        <Text>{view.summary?.overview}</Text>
        <Text c="dimmed" size="sm">
          {view.findings?.length ?? 0} findings
        </Text>
      </Stack>
    </Paper>
  );
}

export function ScanPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { reused?: ReusedReason } };
  const reused = location.state?.reused ?? null;
  const { view, error } = useScanStream(id);
  const [busy, setBusy] = useState(false);

  async function scanAgain(current: ScanView) {
    setBusy(true);
    try {
      const next = await api.createScan(current.repoUrl, current.refRequested ?? undefined, true);
      navigate(`/scans/${next.id}`, { state: { reused: next.reused } });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Alert color="red" title="Could not load this scan">{error}</Alert>;
  if (!view) return <Skeleton height={200} radius="md" />;

  return (
    <Stack gap="lg">
      <ScanHeader view={view} />
      <ReusedBanner reused={reused} view={view} onScanAgain={() => void scanAgain(view)} busy={busy} />
      {view.status === 'failed' && (
        <Alert color="red" title="The scan failed">
          <Stack gap="sm">
            <Text>{view.error}</Text>
            <Button size="xs" variant="light" onClick={() => void scanAgain(view)} loading={busy} w="fit-content">
              Scan again
            </Button>
          </Stack>
        </Alert>
      )}
      {(view.status === 'queued' || view.status === 'running') && <ScanProgress view={view} />}
      {view.status === 'done' && <ScanResultBasic view={view} />}
    </Stack>
  );
}
