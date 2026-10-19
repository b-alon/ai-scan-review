import { Alert, Anchor, Button, Divider, Group, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { ScanListItemRow } from '../components/ScanListItemRow';
import type { ScanListItem } from '../types';

export function HomePage() {
  const navigate = useNavigate();
  const [repoUrl, setRepoUrl] = useState('');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<ScanListItem[]>([]);

  useEffect(() => {
    api
      .listScans(20)
      .then((r) => setRecent(r.scans))
      .catch(() => setRecent([]));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const scan = await api.createScan(repoUrl, ref);
      navigate(`/scans/${scan.id}`, { state: { reused: scan.reused } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack gap="xl">
      <Stack gap="xs">
        <Title order={2}>Scan a GitHub repository</Title>
        <Text c="dimmed">Get a prioritized security review: what matters, what is risky, and what to do next.</Text>
      </Stack>
      <Paper withBorder p="lg" radius="md">
        <form onSubmit={submit}>
          <Stack gap="md">
            <TextInput
              label="Repository URL"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.currentTarget.value)}
              required
              size="md"
            />
            <TextInput
              label="Branch, tag or commit"
              placeholder="default branch"
              value={ref}
              onChange={(e) => setRef(e.currentTarget.value)}
              size="md"
            />
            {error && <Alert color="red">{error}</Alert>}
            <Group justify="flex-end">
              <Button type="submit" loading={busy} size="md">
                Scan
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>
      {recent.length > 0 && (
        <Stack gap="md">
          <Title order={4}>Recent scans</Title>
          {Object.entries(
            recent.reduce<Record<string, ScanListItem[]>>((acc, item) => {
              const key = `${item.repoOwner}/${item.repoName}`;
              (acc[key] ??= []).push(item);
              return acc;
            }, {}),
          ).map(([repo, items]) => (
            <Paper key={repo} withBorder px="md" py="xs" radius="md">
              <Anchor component={Link} to={`/repos/${repo}`} fw={600}>
                {repo}
              </Anchor>
              {items.map((item) => (
                <div key={item.id}>
                  <Divider />
                  <ScanListItemRow item={item} showRepo={false} />
                </div>
              ))}
            </Paper>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
