import { useMemo } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import type { StakeholderView } from '../data/types';

export function useStakeholderFilter<T extends { visibleTo: StakeholderView[] }>(
  items: T[]
): T[] {
  const view = useFlowStore((s) => s.stakeholderView);
  return useMemo(() => items.filter((item) => item.visibleTo.includes(view)), [items, view]);
}
