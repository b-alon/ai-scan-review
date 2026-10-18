import { Stack, Text, Title } from '@mantine/core';

export function HomePage() {
  return (
    <Stack gap="xs">
      <Title order={2}>Scan a GitHub repository</Title>
      <Text c="dimmed">Submit a repository to get a prioritized security review.</Text>
    </Stack>
  );
}
