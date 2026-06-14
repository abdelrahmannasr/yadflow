export const COMPONENT_ICONS: Record<string, string> = {
  'rider-app': 'smartphone',
  'driver-app': 'directions_car',
  'backend-api': 'cloud_queue',
  'bullmq': 'layers',
  'ops-dashboard': 'monitor_heart',
  'pubsub': 'cell_tower',
  'dac': 'assignment',
  'database': 'database',
};

export const COMPONENT_ROLES: Record<string, string> = {
  'rider-app': 'Client',
  'driver-app': 'Client',
  'backend-api': 'Gateway',
  'bullmq': 'Worker',
  'ops-dashboard': 'Dashboard',
  'pubsub': 'Messaging',
  'dac': 'Actions',
  'database': 'Storage',
};

export const CATEGORY_ICONS: Record<string, string> = {
  success: 'check_circle',
  'rider-cancel': 'cancel',
  'driver-cancel': 'person_off',
  timeout: 'schedule',
  ops: 'admin_panel_settings',
  'active-cancel': 'cancel',
};

export const ACTOR_ICONS: Record<string, string> = {
  rider: 'person',
  driver: 'directions_car',
  ops: 'admin_panel_settings',
  system: 'dns',
};

export const MESSAGE_TYPE_ICONS: Record<string, string> = {
  request: 'input',
  response: 'output',
  event: 'bolt',
  job: 'work',
  notification: 'notifications',
  cleanup: 'cleaning_services',
};
