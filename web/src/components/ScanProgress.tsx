import { Alert, Group, Loader, Paper, Stack, Stepper, Text, Timeline } from '@mantine/core';
import { formatDuration } from '../lib/format';
import type { ScanView } from '../types';

const STEPS: Array<{ key: string; label: string; stages: string[] }> = [
  { key: 'fetch', label: 'Fetch', stages: ['fetching'] },
  { key: 'deps', label: 'Dependencies', stages: ['dependencies'] },
  { key: 'code', label: 'Code', stages: ['code'] },
  { key: 'summary', label: 'Summarize', stages: ['summarizing', 'persisting'] },
];

function activeStep(stage: string | null): number {
  const idx = STEPS.findIndex((s) => stage !== null && s.stages.includes(stage));
  return idx < 0 ? 0 : idx;
}

export function ScanProgress({ view }: { view: ScanView }) {
  const retrying = view.status === 'queued' && view.error !== null;
  const waiting = view.status === 'queued' && view.error === null;
  const events = view.events;

  return (
    <Stack gap="lg">
      {retrying && (
        <Alert color="yellow" title={`Retrying (attempt ${view.attempts} of ${view.maxAttempts} failed)`}>
          {view.error}
        </Alert>
      )}
      <Paper withBorder p="lg" radius="md">
        <Stepper active={waiting ? 0 : activeStep(view.stage)} size="sm">
          {STEPS.map((s) => (
            <Stepper.Step key={s.key} label={s.label} loading={!waiting && !retrying && s.stages.includes(view.stage ?? '')} />
          ))}
        </Stepper>
        <Group mt="lg" gap="sm">
          {!retrying && <Loader size="sm" />}
          <Text fw={500}>{waiting ? 'Waiting for a worker to pick up the scan' : view.progressMessage}</Text>
          <Text c="dimmed" size="sm">
            {view.progressPct}%
          </Text>
        </Group>
      </Paper>
      {events.length > 0 && (
        <Timeline active={events.length - 1} bulletSize={18} lineWidth={2}>
          {events.map((e, i) => {
            const next = events[i + 1];
            const duration = next ? new Date(next.createdAt).getTime() - new Date(e.createdAt).getTime() : null;
            return (
              <Timeline.Item key={`${e.createdAt}-${i}`} title={e.message}>
                <Text c="dimmed" size="xs">
                  {e.stage}
                  {duration !== null ? ` · ${formatDuration(duration)}` : ''}
                </Text>
              </Timeline.Item>
            );
          })}
        </Timeline>
      )}
    </Stack>
  );
}
