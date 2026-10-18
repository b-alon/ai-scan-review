import { Badge, Card, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { severityColor } from '../lib/format';
import type { Finding, Summary } from '../types';

export function TopRisks({ risks, findings }: { risks: Summary['topRisks']; findings: Finding[] }) {
  const byFingerprint = new Map(findings.map((f) => [f.fingerprint, f]));
  if (risks.length === 0) return <Text c="dimmed">Nothing stood out.</Text>;
  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
      {risks.map((risk) => {
        const finding = byFingerprint.get(risk.fingerprint);
        return (
          <Card key={risk.fingerprint} withBorder radius="md" padding="md">
            <Stack gap="xs">
              <Group gap="xs">
                {finding && (
                  <Badge color={severityColor(finding.severity)} variant="light">
                    {finding.severity}
                  </Badge>
                )}
                <Text fw={600}>{risk.title}</Text>
              </Group>
              {finding && (
                <Text size="xs" c="dimmed" ff="monospace">
                  {finding.location}
                </Text>
              )}
              <Text size="sm">{risk.whyItMatters}</Text>
            </Stack>
          </Card>
        );
      })}
    </SimpleGrid>
  );
}
