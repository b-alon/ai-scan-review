import { Alert, Button, Group, Text } from '@mantine/core';
import { timeAgo } from '../lib/format';
import type { ReusedReason, ScanView } from '../types';

export function ReusedBanner({ reused, view, onScanAgain, busy }: { reused: ReusedReason; view: ScanView; onScanAgain: () => void; busy: boolean }) {
  if (reused === 'in_progress') {
    return (
      <Alert color="blue" title="Joined a scan already in progress">
        A scan of this commit was already running. You are watching that one.
      </Alert>
    );
  }
  if (reused === 'recent') {
    return (
      <Alert color="blue" title={`This commit was scanned ${view.finishedAt ? timeAgo(view.finishedAt) : 'recently'}`}>
        <Group justify="space-between" align="center">
          <Text size="sm">Showing that result. Advisory data changes over time, so you can run a fresh scan.</Text>
          <Button size="xs" variant="light" onClick={onScanAgain} loading={busy}>
            Scan again
          </Button>
        </Group>
      </Alert>
    );
  }
  return null;
}
