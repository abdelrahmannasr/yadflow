import type { StakeholderView } from './types';

export interface RoleConfig {
  slug: StakeholderView;
  label: string;
  shortLabel: string;
  icon: string;
  color: string;
  description: string;
  sectionIds: string[];
  relevantPathIds: number[];
}

export const ROLES: RoleConfig[] = [
  {
    slug: 'rider-mobile-dev',
    label: 'Rider Mobile Developer',
    shortLabel: 'Rider Dev',
    icon: 'phone_iphone',
    color: '#7b59e6',
    description: 'Integration guide for rider app — booking status endpoints, UI states, deeplink actions, and notification payloads.',
    sectionIds: [
      'rider-integration',
      'rider-ui-states',
      'deeplinks',
      'notification-localization',
      'cancelability',
      'troubleshooting',
    ],
    relevantPathIds: [1, 2, 3, 4, 5, 6, 9, 10, 11],
  },
  {
    slug: 'driver-mobile-dev',
    label: 'Driver Mobile Developer',
    shortLabel: 'Driver Dev',
    icon: 'directions_car',
    color: '#06b6d4',
    description: 'Integration guide for driver app — booking status endpoints, DAC cards, confirmation flows, and push notifications.',
    sectionIds: [
      'driver-integration',
      'driver-ui-states',
      'deeplinks',
      'notification-localization',
      'cancelability',
      'troubleshooting',
    ],
    relevantPathIds: [1, 7, 8, 9, 10, 11],
  },
  {
    slug: 'backend-dev',
    label: 'Backend Developer',
    shortLabel: 'Backend',
    icon: 'terminal',
    color: '#10b981',
    description: 'API reference, middleware chains, status machine, database schema, BullMQ jobs, deployment, and security.',
    sectionIds: [
      'api-reference',
      'status-machine',
      'middleware-chain',
      'decision-tree',
      'bullmq-jobs',
      'db-schema',
      'deployment',
      'security',
      'troubleshooting',
    ],
    relevantPathIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  },
  {
    slug: 'product-manager',
    label: 'Product Manager',
    shortLabel: 'PM',
    icon: 'bar_chart',
    color: '#f59e0b',
    description: 'Executive summary, feature overview, flow paths, feature flags, cancelability rules, and product roadmap.',
    sectionIds: [
      'executive-summary',
      'flow-overview',
      'cancelability',
      'feature-flags',
      'pm-roadmap',
    ],
    relevantPathIds: [1, 2, 3, 9, 10],
  },
  {
    slug: 'engineering-manager',
    label: 'Engineering Manager',
    shortLabel: 'EM',
    icon: 'groups',
    color: '#8b5cf6',
    description: 'Executive summary, deployment guide, monitoring & alerting, performance testing, and critical runbook.',
    sectionIds: [
      'executive-summary',
      'flow-overview',
      'deployment',
      'monitoring-alerting',
      'performance-testing',
      'critical-runbook',
    ],
    relevantPathIds: [1, 2, 3, 9, 10],
  },
  {
    slug: 'staff-engineer',
    label: 'Staff Engineer',
    shortLabel: 'Staff Eng',
    icon: 'engineering',
    color: '#ec4899',
    description: 'Deep-dive into status machine, middleware architecture, decision tree, data migration, security, and performance.',
    sectionIds: [
      'status-machine',
      'middleware-chain',
      'decision-tree',
      'api-reference',
      'bullmq-jobs',
      'feature-flags',
      'data-migration',
      'security',
      'performance-testing',
      'db-schema',
      'troubleshooting',
    ],
    relevantPathIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  },
  {
    slug: 'qa-engineer',
    label: 'QA Engineer',
    shortLabel: 'QA',
    icon: 'bug_report',
    color: '#ef4444',
    description: 'Test plan, feature flag matrix, error codes, flow path checklist, and troubleshooting guide.',
    sectionIds: [
      'test-plan',
      'flow-paths-checklist',
      'feature-flags',
      'error-codes',
      'cancelability',
      'troubleshooting',
    ],
    relevantPathIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  },
];

export function getRoleBySlug(slug: string): RoleConfig | undefined {
  return ROLES.find((r) => r.slug === slug);
}
