// Icon + label maps for the yadflow SDLC-overview canvas. Component ids match
// data/components.ts; actor keys match the ActorType union; category keys match
// the PathCategory phases; message-type keys match MessageType.

export const COMPONENT_ICONS: Record<string, string> = {
  'product-hub': 'account_balance',
  'state-json': 'explore',
  'approvals-json': 'task_alt',
  'contract-lock': 'lock',
  'repos-json': 'inventory_2',
  'code-repos': 'deployed_code',
  'design-json': 'palette',
  'testing-json': 'science',
  'learning-json': 'school',
  'docs-json': 'menu_book',
  'design-tool': 'brush',
  'testing-tool': 'theater_comedy',
  'learning-tool': 'psychology',
  platform: 'hub',
  'trust-log': 'trending_up',
  'change-json': 'manage_history',
  'reconcile-debt-json': 'running_with_errors',
  'build-log-json': 'receipt_long',
};

export const COMPONENT_ROLES: Record<string, string> = {
  'product-hub': 'Hub',
  'state-json': 'Ledger',
  'approvals-json': 'Ledger',
  'contract-lock': 'Lock',
  'repos-json': 'Registry',
  'code-repos': 'Repos',
  'design-json': 'Registry',
  'testing-json': 'Registry',
  'learning-json': 'Registry',
  'docs-json': 'Registry',
  'design-tool': 'Tool',
  'testing-tool': 'Tool',
  'learning-tool': 'Tool',
  platform: 'Platform',
  'trust-log': 'Evidence',
  'change-json': 'Thread',
  'reconcile-debt-json': 'Debt',
  'build-log-json': 'Ledger',
};

export const CATEGORY_ICONS: Record<string, string> = {
  setup: 'settings',
  front: 'edit_note',
  build: 'build',
  automate: 'smart_toy',
  change: 'manage_history',
};

export const ACTOR_ICONS: Record<string, string> = {
  analyst: 'search',
  pm: 'bar_chart',
  architect: 'architecture',
  ux: 'design_services',
  dev: 'terminal',
  tester: 'science',
  reviewer: 'rate_review',
  engineer: 'engineering',
  system: 'dns',
};

export const MESSAGE_TYPE_ICONS: Record<string, string> = {
  write: 'edit_document',
  gate: 'gavel',
  event: 'bolt',
  job: 'work',
  notification: 'notifications',
  cleanup: 'block',
};
