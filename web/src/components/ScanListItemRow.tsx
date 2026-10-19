import { Anchor, Badge, Group, Text } from '@mantine/core';
import { Link } from 'react-router';
import { riskColor, shortSha, timeAgo } from '../lib/format';
import type { ScanListItem } from '../types';

const STATUS_COLOR: Record<ScanListItem['status'], string> = { queued: 'gray', running: 'blue', done: 'green', failed: 'red' };

export function ScanListItemRow({ item, showRepo = true }: { item: ScanListItem; showRepo?: boolean }) {
  return (
    <Group justify="space-between" wrap="nowrap" py="xs">
      <Group gap="sm" wrap="nowrap">
        {showRepo ? (
          <Anchor component={Link} to={`/scans/${item.id}`} fw={500}>
            {item.repoOwner}/{item.repoName}
          </Anchor>
        ) : (
          <Anchor component={Link} to={`/scans/${item.id}`} fw={500} ff="monospace">
            {shortSha(item.commitSha)}
          </Anchor>
        )}
        {showRepo && (
          <Text c="dimmed" size="sm" ff="monospace">
            {shortSha(item.commitSha)}
          </Text>
        )}
        <Text c="dimmed" size="sm">
          {timeAgo(item.createdAt)}
        </Text>
      </Group>
      <Group gap="xs" wrap="nowrap">
        {item.riskLevel && (
          <Badge color={riskColor(item.riskLevel)} variant="light">
            {item.riskLevel === 'none' ? 'no issues' : `${item.riskLevel} risk`}
          </Badge>
        )}
        <Badge color={STATUS_COLOR[item.status]} variant="outline">
          {item.status}
        </Badge>
      </Group>
    </Group>
  );
}
