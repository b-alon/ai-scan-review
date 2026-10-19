import { Anchor, Badge, Code, Collapse, Group, SegmentedControl, Stack, Table, Text } from '@mantine/core';
import { useMemo, useState } from 'react';
import { SEVERITIES, severityColor } from '../lib/format';
import type { Category, Finding, Severity } from '../types';

type SeverityFilter = 'all' | Severity;
type CategoryFilter = 'all' | Category;

export function FindingsTable({ findings }: { findings: Finding[] }) {
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(
    () => findings.filter((f) => (severity === 'all' || f.severity === severity) && (category === 'all' || f.category === category)),
    [findings, severity, category],
  );

  return (
    <Stack gap="sm">
      <Group gap="md">
        <SegmentedControl
          size="xs"
          value={severity}
          onChange={(v) => setSeverity(v as SeverityFilter)}
          data={[{ label: 'all severities', value: 'all' }, ...SEVERITIES.map((s) => ({ label: s, value: s }))]}
        />
        <SegmentedControl
          size="xs"
          value={category}
          onChange={(v) => setCategory(v as CategoryFilter)}
          data={[
            { label: 'all categories', value: 'all' },
            { label: 'dependency', value: 'dependency' },
            { label: 'code', value: 'code' },
            { label: 'config', value: 'config' },
          ]}
        />
        <Text size="sm" c="dimmed">
          {rows.length} of {findings.length}
        </Text>
      </Group>
      <Table highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={110}>Severity</Table.Th>
            <Table.Th>Finding</Table.Th>
            <Table.Th>Location</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((f) => (
            <Table.Tr key={f.fingerprint} style={{ cursor: 'pointer' }} onClick={() => setOpen(open === f.fingerprint ? null : f.fingerprint)}>
              <Table.Td>
                <Badge color={severityColor(f.severity)} variant="light">
                  {f.severity}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Text fw={500}>{f.title}</Text>
                <Collapse expanded={open === f.fingerprint}>
                  <Stack gap="xs" mt="xs">
                    <Text size="sm">{f.description}</Text>
                    {f.evidence && <Code block>{f.evidence}</Code>}
                    <Text size="sm">
                      <Text span fw={600}>
                        Recommendation:
                      </Text>{' '}
                      {f.recommendation}
                    </Text>
                    {f.referenceUrl && (
                      <Anchor href={f.referenceUrl} target="_blank" size="sm">
                        {f.referenceId ?? f.referenceUrl}
                      </Anchor>
                    )}
                  </Stack>
                </Collapse>
              </Table.Td>
              <Table.Td>
                <Text size="xs" ff="monospace" c="dimmed">
                  {f.location}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
