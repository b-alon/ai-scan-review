import { Badge, Collapse, Group, List, Paper, Stack, Text, UnstyledButton } from '@mantine/core';
import { useState } from 'react';
import type { Finding, Summary } from '../types';

const EFFORT_COLOR = { minutes: 'green', hours: 'yellow', days: 'orange' } as const;

export function NextActions({ actions, findings }: { actions: Summary['nextActions']; findings: Finding[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const byFingerprint = new Map(findings.map((f) => [f.fingerprint, f]));
  if (actions.length === 0) return <Text c="dimmed">No actions needed.</Text>;
  return (
    <Stack gap="sm">
      {actions.map((action, i) => {
        const resolved = action.resolves.map((fp) => byFingerprint.get(fp)).filter((f): f is Finding => Boolean(f));
        return (
          <Paper key={`${i}-${action.action}`} withBorder radius="md" p="md">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Group gap="sm" align="flex-start" wrap="nowrap" style={{ flex: '1 1 auto', minWidth: 0 }}>
                <Badge circle size="lg" variant="filled" style={{ flex: '0 0 auto' }}>
                  {i + 1}
                </Badge>
                <Text>{action.action}</Text>
              </Group>
              <Badge color={EFFORT_COLOR[action.effort]} variant="light" style={{ flex: '0 0 auto' }}>
                {action.effort}
              </Badge>
            </Group>
            {resolved.length > 0 && (
              <Stack gap={4} mt="xs" pl={44}>
                <UnstyledButton onClick={() => setOpen(open === i ? null : i)}>
                  <Text size="xs" c="dimmed">
                    {open === i ? 'Hide' : 'Show'} the {resolved.length} finding{resolved.length === 1 ? '' : 's'} this resolves
                  </Text>
                </UnstyledButton>
                <Collapse expanded={open === i}>
                  <List size="sm">
                    {resolved.map((f) => (
                      <List.Item key={f.fingerprint}>{f.title}</List.Item>
                    ))}
                  </List>
                </Collapse>
              </Stack>
            )}
          </Paper>
        );
      })}
    </Stack>
  );
}
