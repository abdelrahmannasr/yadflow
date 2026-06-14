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

// The yadflow LENSES. Each lens points at the doc sections + phase paths that
// matter to it. sectionIds are a subset of DOC_SECTIONS (docSections.ts);
// relevantPathIds index PATHS (1 setup · 2 front · 3 build · 4 automation).
// Sorted by stable slug for determinism.
export const ROLES: RoleConfig[] = [
  {
    slug: 'analyst',
    label: 'Analyst',
    shortLabel: 'Analyst',
    icon: 'search',
    color: '#2471a3',
    description: 'Pressure-tests the idea into analysis.md, seeds the .sdlc state, and hands off to the review gate.',
    sectionIds: ['executive-summary', 'gated-flow', 'review-gate', 'glossary'],
    relevantPathIds: [1, 2],
  },
  {
    slug: 'architect',
    label: 'Architect',
    shortLabel: 'Architect',
    icon: 'architecture',
    color: '#566573',
    description: 'Authors architecture.md + the locked contract.md and hash-locks the cross-repo CONTRACT-SURFACE.',
    sectionIds: ['contract-lock', 'gated-flow', 'review-gate', 'connectors', 'glossary'],
    relevantPathIds: [2, 3],
  },
  {
    slug: 'dev',
    label: 'Developer',
    shortLabel: 'Dev',
    icon: 'terminal',
    color: '#1e8449',
    description: 'Specs a story, implements one atomic task per branch, and runs the check gates before the PR.',
    sectionIds: ['gated-flow', 'check-gates', 'contract-lock', 'cli-reference', 'glossary'],
    relevantPathIds: [3, 4],
  },
  {
    slug: 'engineer',
    label: 'Engineer (Merge Owner)',
    shortLabel: 'Engineer',
    icon: 'engineering',
    color: '#ca6f1e',
    description: 'Owns the human merge gate: advisory AI first-pass, engineer review, and the trust-log evidence for earned automation.',
    sectionIds: ['executive-summary', 'gated-flow', 'two-dials', 'check-gates', 'cli-reference', 'glossary'],
    relevantPathIds: [3, 4],
  },
  {
    slug: 'maintainer',
    label: 'Maintainer',
    shortLabel: 'Maintainer',
    icon: 'admin_panel_settings',
    color: '#7d3c98',
    description: 'Operates yadflow itself: the connectors, the two dials, the CLI surface, and the kill switch.',
    sectionIds: ['executive-summary', 'connectors', 'two-dials', 'cli-reference', 'glossary'],
    relevantPathIds: [1, 4],
  },
  {
    slug: 'pm',
    label: 'Product Manager',
    shortLabel: 'PM',
    icon: 'bar_chart',
    color: '#b7950b',
    description: 'Authors the epic and the repo-tagged stories, then takes each through the team review gate.',
    sectionIds: ['executive-summary', 'gated-flow', 'review-gate', 'glossary'],
    relevantPathIds: [2],
  },
  {
    slug: 'reviewer',
    label: 'Reviewer',
    shortLabel: 'Reviewer',
    icon: 'rate_review',
    color: '#ca6f1e',
    description: 'Comments and approves at every gate — owner + 1 reviewer, escalating to domain owners on contract/auth/payments.',
    sectionIds: ['review-gate', 'gated-flow', 'contract-lock', 'glossary'],
    relevantPathIds: [2, 3],
  },
  {
    slug: 'tester',
    label: 'Test Architect',
    shortLabel: 'Tester',
    icon: 'science',
    color: '#1e8449',
    description: 'Runs the parallel test-cases track: authors test-cases.md and implements automation in the connected testing tool.',
    sectionIds: ['gated-flow', 'check-gates', 'connectors', 'glossary'],
    relevantPathIds: [2, 3],
  },
  {
    slug: 'ux-designer',
    label: 'UX Designer',
    shortLabel: 'UX',
    icon: 'design_services',
    color: '#ca6f1e',
    description: 'Authors ui-design.md + DESIGN.md and materializes the feature screens in the connected design tool.',
    sectionIds: ['gated-flow', 'review-gate', 'connectors', 'glossary'],
    relevantPathIds: [2],
  },
];

export function getRoleBySlug(slug: string): RoleConfig | undefined {
  return ROLES.find((r) => r.slug === slug);
}
