import { Accordion, Anchor, Badge, Group, List, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router';
import { shortSha } from '../lib/format';
import type { Comparison, Finding } from '../types';

function Section({ value, label, color, items }: { value: string; label: string; color: string; items: Finding[] }) {
  return (
    <Accordion.Item value={value}>
      <Accordion.Control disabled={items.length === 0}>
        <Group gap="xs">
          <Badge color={color} variant="light">
            {items.length}
          </Badge>
          <Text>{label}</Text>
        </Group>
      </Accordion.Control>
      <Accordion.Panel>
        <List size="sm">
          {items.map((f) => (
            <List.Item key={f.fingerprint}>
              {f.title}{' '}
              <Text span c="dimmed" size="xs" ff="monospace">
                {f.location}
              </Text>
            </List.Item>
          ))}
        </List>
      </Accordion.Panel>
    </Accordion.Item>
  );
}

export function ComparisonSection({ comparison, previousFinishedAgo }: { comparison: Comparison; previousFinishedAgo: string | null }) {
  return (
    <Stack gap="sm">
      <Title order={3}>
        {comparison.sameCommit ? `Same commit as your previous scan${previousFinishedAgo ? `, ${previousFinishedAgo}` : ''}` : 'Since previous scan'}
      </Title>
      <Text c="dimmed" size="sm">
        {comparison.sameCommit ? (
          'Any differences below come from updated advisory data, not code changes.'
        ) : (
          <>
            Compared with commit{' '}
            <Anchor component={Link} to={`/scans/${comparison.previousScanId}`} ff="monospace">
              {shortSha(comparison.previousSha)}
            </Anchor>
            .
          </>
        )}
      </Text>
      <Text fw={500}>
        {comparison.fixed.length} fixed · {comparison.new.length} new · {comparison.stillOpen.length} still open
      </Text>
      <Accordion variant="separated" multiple>
        <Section value="fixed" label="Fixed" color="green" items={comparison.fixed} />
        <Section value="new" label="New" color="red" items={comparison.new} />
        <Section value="open" label="Still open" color="gray" items={comparison.stillOpen} />
      </Accordion>
    </Stack>
  );
}
