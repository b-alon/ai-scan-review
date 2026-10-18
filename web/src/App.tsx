import { Anchor, AppShell, Container, Group, MantineProvider, Title } from '@mantine/core';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { HomePage } from './pages/HomePage';
import { ScanPage } from './pages/ScanPage';

export function App() {
  return (
    <MantineProvider defaultColorScheme="auto">
      <BrowserRouter>
        <AppShell header={{ height: 56 }} padding="md">
          <AppShell.Header>
            <Group h="100%" px="md">
              <Anchor component={Link} to="/" underline="never" c="inherit">
                <Title order={4}>AI Scan Review</Title>
              </Anchor>
            </Group>
          </AppShell.Header>
          <AppShell.Main>
            <Container size="lg">
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/scans/:id" element={<ScanPage />} />
              </Routes>
            </Container>
          </AppShell.Main>
        </AppShell>
      </BrowserRouter>
    </MantineProvider>
  );
}
