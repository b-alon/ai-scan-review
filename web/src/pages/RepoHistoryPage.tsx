import { Anchor, Divider, Paper, Skeleton, Stack, Text, Title } from '@mantine/core';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { api } from '../api';
import { ScanListItemRow } from '../components/ScanListItemRow';
import type { ScanListItem } from '../types';

export function RepoHistoryPage() {
  const { owner = '', name = '' } = useParams();
  const [items, setItems] = useState<ScanListItem[] | null>(null);
  useEffect(() => {
    api
      .listScans(200)
      .then((r) => setItems(r.scans.filter((s) => s.repoOwner === owner && s.repoName === name)))
      .catch(() => setItems([]));
  }, [owner, name]);
  return (
    <Stack gap="md">
      <Stack gap={2}>
        <Title order={2}>
          {owner}/{name}
        </Title>
        <Anchor href={`https://github.com/${owner}/${name}`} target="_blank" size="sm">
          View on GitHub
        </Anchor>
      </Stack>
      {items === null && <Skeleton height={120} radius="md" />}
      {items !== null && items.length === 0 && <Text c="dimmed">No scans yet for this repository.</Text>}
      {items !== null && items.length > 0 && (
        <Paper withBorder px="md" radius="md">
          {items.map((item, i) => (
            <div key={item.id}>
              {i > 0 && <Divider />}
              <ScanListItemRow item={item} showRepo={false} />
            </div>
          ))}
        </Paper>
      )}
    </Stack>
  );
}
