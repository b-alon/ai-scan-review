import { Badge } from '@mantine/core';
import { riskColor } from '../lib/format';
import type { RiskLevel } from '../types';

export function RiskBadge({ risk, size = 'lg' }: { risk: RiskLevel; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  return (
    <Badge color={riskColor(risk)} size={size} variant="filled">
      {risk === 'none' ? 'No issues' : `${risk} risk`}
    </Badge>
  );
}
