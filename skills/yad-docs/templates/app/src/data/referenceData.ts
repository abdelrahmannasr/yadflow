import type { StakeholderView } from './types';

// ─── Stakeholder-filterable base ───

interface Filterable {
  visibleTo: StakeholderView[];
}

const ALL: StakeholderView[] = [
  'rider-mobile-dev', 'driver-mobile-dev', 'backend-dev',
  'product-manager', 'engineering-manager', 'staff-engineer', 'qa-engineer',
];
const MOBILE: StakeholderView[] = ['rider-mobile-dev', 'driver-mobile-dev'];
const DEEP_TECH: StakeholderView[] = ['backend-dev', 'staff-engineer', 'qa-engineer'];

// ─── Decision Tree ───

export interface DecisionBranch {
  condition: string;
  result: string;
  detail?: string;
  visibleTo: StakeholderView[];
}

export const DECISION_TREE: DecisionBranch[] = [
  {
    condition: 'ENABLE_DRIVER_CONFIRMATION = false',
    result: 'Push generic history entry, return',
    detail: 'No driver confirmation flow — just records the assignment in booking_status_history',
    visibleTo: ALL,
  },
  {
    condition: 'timeRemaining <= threshold (40 min)',
    result: 'handleFastTrackAssignment',
    detail: 'Auto-confirms driver (BOOK_DRIVER_CONFIRMED), pushes 2 history entries with fast_track reason, publishes DAC, notifies both rider + driver',
    visibleTo: ALL,
  },
  {
    condition: 'timeRemaining > threshold (40 min)',
    result: 'Normal assignment path',
    detail: 'Pushes history entry, schedules PRE_TRIP_DRIVER_CONFIRMATION job, publishes DAC card to driver',
    visibleTo: ALL,
  },
];

// ─── Rider UI States ───

export interface UIState extends Filterable {
  state: string;
  endpoint: string;
  schemaValue: string;
  isTerminal: boolean;
  description: string;
}

export const RIDER_UI_STATES: UIState[] = [
  {
    state: 'BOOK_CONFIRMED',
    endpoint: 'PUT /rider/trips/:tripId/booking-status',
    schemaValue: 'BOOK_CONFIRMED',
    isTerminal: false,
    description: 'Rider confirms the scheduled ride',
    visibleTo: ALL,
  },
  {
    state: 'BOOK_UNCONFIRMED',
    endpoint: 'PUT /rider/trips/:tripId/booking-status',
    schemaValue: 'BOOK_UNCONFIRMED',
    isTerminal: false,
    description: 'Rider declines confirmation (maps to BOOK_RIDER_CANCELED)',
    visibleTo: ALL,
  },
  {
    state: 'RIDER_CANCELED',
    endpoint: 'PUT /rider/trips/:tripId/booking-status',
    schemaValue: 'RIDER_CANCELED',
    isTerminal: true,
    description: 'Rider explicitly cancels the booking',
    visibleTo: ALL,
  },
];

export const DRIVER_UI_STATES: UIState[] = [
  {
    state: 'BOOK_ACCEPTED',
    endpoint: 'PUT /b2c/driver/trips/:tripId/booking-status',
    schemaValue: 'BOOK_ACCEPTED',
    isTerminal: false,
    description: 'Driver accepts the scheduled ride',
    visibleTo: ALL,
  },
  {
    state: 'BOOK_DRIVER_CANCELED',
    endpoint: 'PUT /b2c/driver/trips/:tripId/booking-status',
    schemaValue: 'BOOK_DRIVER_CANCELED',
    isTerminal: true,
    description: 'Driver cancels the assigned ride',
    visibleTo: ALL,
  },
];

// ─── BullMQ Jobs ───

export interface BullMQJob extends Filterable {
  name: string;
  queue: string;
  timing: string;
  description: string;
  triggeredBy: string;
}

export const BULLMQ_JOBS: BullMQJob[] = [
  {
    name: 'pre-trip-rider-confirmation',
    queue: 'booking-trips',
    timing: 'booked_for - 24h',
    description: 'Sends push notification asking rider to confirm the booking',
    triggeredBy: 'Trip creation (scheduleBookingJobs middleware)',
    visibleTo: ALL,
  },
  {
    name: 'rider-confirmation-timeout',
    queue: 'booking-trips',
    timing: '30 min after rider confirmation sent',
    description: 'Escalates to ops if rider has not responded',
    triggeredBy: 'pre-trip-rider-confirmation job completion',
    visibleTo: ALL,
  },
  {
    name: 'ops-rider-confirmation-window-timeout',
    queue: 'booking-trips',
    timing: '15 min after rider timeout',
    description: 'System cancels booking if ops did not intervene',
    triggeredBy: 'rider-confirmation-timeout job completion',
    visibleTo: ALL,
  },
  {
    name: 'pre-trip-driver-confirmation',
    queue: 'booking-trips',
    timing: 'booked_for - 40 min',
    description: 'Sends push notification asking driver to confirm availability',
    triggeredBy: 'handleBookAssigned (normal path)',
    visibleTo: ALL,
  },
  {
    name: 'driver-confirmation-timeout',
    queue: 'booking-trips',
    timing: '5 min after driver confirmation sent',
    description: 'Escalates to ops if driver has not responded',
    triggeredBy: 'pre-trip-driver-confirmation job completion',
    visibleTo: ALL,
  },
  {
    name: 'ops-driver-confirmation-window-timeout',
    queue: 'booking-trips',
    timing: '10 min after driver timeout',
    description: 'System cancels booking if ops did not intervene',
    triggeredBy: 'driver-confirmation-timeout job completion',
    visibleTo: ALL,
  },
];

// ─── Feature Flags ───

export interface FeatureFlag extends Filterable {
  name: string;
  envVar: string;
  defaultValue: boolean;
  stagingValue: boolean;
  productionValue: boolean;
  description: string;
}

export const FEATURE_FLAGS: FeatureFlag[] = [
  {
    name: 'ENABLE_BOOKING_JOBS',
    envVar: 'ENABLE_BOOKING_JOBS',
    defaultValue: false,
    stagingValue: true,
    productionValue: false,
    description: 'Master switch for all booking-related BullMQ jobs. When false, no scheduled jobs fire.',
    visibleTo: ALL,
  },
  {
    name: 'ENABLE_PRE_TRIP_RIDER_CONFIRMATION',
    envVar: 'ENABLE_PRE_TRIP_RIDER_CONFIRMATION',
    defaultValue: false,
    stagingValue: true,
    productionValue: false,
    description: 'Enables the pre-trip rider confirmation flow (24h before booked_for).',
    visibleTo: ALL,
  },
  {
    name: 'ENABLE_DRIVER_CONFIRMATION',
    envVar: 'ENABLE_DRIVER_CONFIRMATION',
    defaultValue: false,
    stagingValue: false,
    productionValue: false,
    description: 'Enables driver confirmation flow within fnUpdateBookingStatus. Controls fast-track vs normal path on assignment.',
    visibleTo: ALL,
  },
];

// ─── Deeplink Actions ───

export interface DeeplinkAction extends Filterable {
  constant: string;
  value: string;
  target: 'rider' | 'driver';
  category: string;
  description: string;
}

export const DEEPLINK_ACTIONS: DeeplinkAction[] = [
  {
    constant: 'CONFIRM_BOOKING',
    value: 'confirm_booking',
    target: 'rider',
    category: 'booking_confirmation',
    description: 'Opens rider app to confirm scheduled ride',
    visibleTo: ALL,
  },
  {
    constant: 'BOOKING_TIMEOUT',
    value: 'booking_timeout',
    target: 'rider',
    category: 'booking_timeout',
    description: 'Rider confirmation timeout notification',
    visibleTo: ALL,
  },
  {
    constant: 'BOOKING_CANCELLED',
    value: 'booking_cancelled',
    target: 'rider',
    category: 'booking_ops_window_timeout_cancellation',
    description: 'System/ops cancelled the booking',
    visibleTo: ALL,
  },
  {
    constant: 'BOOKING_CANCELED_BY_RIDER',
    value: 'booking_canceled_by_rider',
    target: 'driver',
    category: 'booking_rider_cancellation',
    description: 'Notifies driver that rider cancelled',
    visibleTo: ALL,
  },
  {
    constant: 'CONFIRM_DRIVER_BOOKING',
    value: 'confirm_driver_booking',
    target: 'driver',
    category: 'driver_booking_confirmation',
    description: 'Opens driver app to confirm availability',
    visibleTo: ALL,
  },
  {
    constant: 'DRIVER_BOOKING_TIMEOUT',
    value: 'driver_booking_timeout',
    target: 'driver',
    category: 'driver_booking_timeout',
    description: 'Driver confirmation timeout notification',
    visibleTo: ALL,
  },
  {
    constant: 'DRIVER_BOOKING_OPS_CANCELLED',
    value: 'driver_booking_ops_cancelled',
    target: 'driver',
    category: 'driver_booking_ops_window_timeout_cancellation',
    description: 'Ops cancelled the driver assignment',
    visibleTo: ALL,
  },
  {
    constant: 'BOOKING_DRIVER_ASSIGNED',
    value: 'booking_driver_assigned',
    target: 'driver',
    category: 'booking_driver_assignment',
    description: 'Notifies driver of new scheduled ride assignment',
    visibleTo: ALL,
  },
  {
    constant: 'BOOKING_DRIVER_ASSIGNED_RIDER',
    value: 'booking_driver_assigned_rider',
    target: 'rider',
    category: 'booking_driver_assignment',
    description: 'Notifies rider that a driver has been assigned',
    visibleTo: ALL,
  },
  {
    constant: 'BOOKING_CANCELED_BY_DRIVER',
    value: 'booking_canceled_by_driver',
    target: 'rider',
    category: 'booking_driver_cancellation',
    description: 'Notifies rider that driver cancelled',
    visibleTo: ALL,
  },
  {
    constant: 'BOOKING_DRIVER_CONFIRMED_RIDER',
    value: 'booking_driver_confirmed_rider',
    target: 'rider',
    category: 'booking_driver_assignment',
    description: 'Notifies rider that driver confirmed the ride',
    visibleTo: ALL,
  },
];

// ─── Error Codes / Troubleshooting ───

export interface ErrorCode extends Filterable {
  code: string;
  httpStatus?: number;
  cause: string;
  resolution: string;
  severity: 'info' | 'warn' | 'critical';
}

export const ERROR_CODES: ErrorCode[] = [
  {
    code: 'CONCURRENT_UPDATE (modifiedCount: 0)',
    httpStatus: 409,
    cause: 'Optimistic lock failure — another request modified the booking_status between read and write',
    resolution: 'Retry the modification or refresh state. The middleware skips silently when modifiedCount is 0.',
    severity: 'warn',
    visibleTo: ALL,
  },
  {
    code: 'INVALID_BOOKING_STATUS_TRANSITION',
    httpStatus: 409,
    cause: 'Attempted transition not in VALID_RIDER_TRANSITIONS or VALID_DRIVER_TRANSITIONS map',
    resolution: 'Check current booking_status and verify the transition is allowed. See Section 4.3/4.4 of documentation.',
    severity: 'critical',
    visibleTo: ALL,
  },
  {
    code: 'NOT_A_BOOKED_TRIP',
    httpStatus: 404,
    cause: 'Trip exists but is_booked is false — booking endpoints only work for scheduled rides',
    resolution: 'Verify the trip was created with is_booked: true and booked_for fields.',
    severity: 'info',
    visibleTo: ALL,
  },
  {
    code: 'TRIP_NOT_CANCELABLE',
    httpStatus: 409,
    cause: 'Trip status is DRIVER_ARRIVED, STARTED, or FINISHED — rider cannot cancel at this stage',
    resolution: 'This is expected behavior. The trip has progressed past the cancelable window.',
    severity: 'info',
    visibleTo: ALL,
  },
  {
    code: 'BullMQ Job Not Found',
    cause: 'Cleanup attempted to remove a job that doesn\'t exist (already processed or never scheduled)',
    resolution: 'Safe to ignore — cleanup functions are fire-and-forget with .catch(log). Verify feature flags are enabled.',
    severity: 'warn',
    visibleTo: DEEP_TECH,
  },
  {
    code: 'DAC Publish/Delete Failed',
    cause: 'Google Cloud Pub/Sub connectivity issue or topic misconfiguration',
    resolution: 'Check PUB_SUB_DRIVER_ACTIONS_TOPIC env var and GCP credentials. DAC operations are fire-and-forget.',
    severity: 'critical',
    visibleTo: DEEP_TECH,
  },
  {
    code: 'Notification Send Failed',
    cause: 'FCM/APNS delivery failure or missing device token',
    resolution: 'Check notification service logs. sendBookingNotificationWithConfig wraps errors with .catch(log) — won\'t block the response.',
    severity: 'warn',
    visibleTo: [...MOBILE, 'backend-dev', 'staff-engineer'],
  },
];

// ─── Status Mapping (for reference display) ───

export interface StatusMapping extends Filterable {
  tripStatus: string;
  bookingStatus: string;
  category: string;
}

export const STATUS_MAPPINGS: StatusMapping[] = [
  { tripStatus: 'TRIP_FINISHED', bookingStatus: 'TRIP_BOOK_FINISHED', category: 'Completion', visibleTo: ALL },
  { tripStatus: 'TRIP_RIDER_CANCELED', bookingStatus: 'TRIP_BOOK_OPERATION_RIDER_CANCELED', category: 'Rider cancel', visibleTo: ALL },
  { tripStatus: 'TRIP_DRIVER_CANCELED', bookingStatus: 'TRIP_BOOK_OPERATION_DRIVER_CANCELED', category: 'Driver cancel', visibleTo: ALL },
  { tripStatus: 'TRIP_DRIVER_CANCELED_TIMEOUT', bookingStatus: 'TRIP_BOOK_OPERATION_DRIVER_CANCELED', category: 'Driver cancel', visibleTo: ALL },
  { tripStatus: 'TRIP_NO_DRIVER_AVAILABLE', bookingStatus: 'TRIP_BOOK_SYSTEM_CANCELED', category: 'System cancel', visibleTo: ALL },
  { tripStatus: 'TRIP_DRIVER_COMING_CANCELED', bookingStatus: 'TRIP_BOOK_OPERATION_DRIVER_CANCELED', category: 'Active trip cancel', visibleTo: ALL },
  { tripStatus: 'TRIP_DRIVER_COMING_RIDER_CANCELED', bookingStatus: 'TRIP_BOOK_OPERATION_RIDER_CANCELED', category: 'Active trip cancel', visibleTo: ALL },
  { tripStatus: 'TRIP_DRIVER_ARRIVED_CANCELED', bookingStatus: 'TRIP_BOOK_OPERATION_DRIVER_CANCELED', category: 'Active trip cancel', visibleTo: ALL },
  { tripStatus: 'TRIP_DRIVER_ARRIVED_RIDER_CANCELED', bookingStatus: 'TRIP_BOOK_OPERATION_RIDER_CANCELED', category: 'Active trip cancel', visibleTo: ALL },
  { tripStatus: 'TRIP_BOOK_DECLINED', bookingStatus: 'TRIP_BOOK_OPERATION_DRIVER_CANCELED', category: 'Driver cancel', visibleTo: ALL },
  { tripStatus: 'TRIP_BOOK_ACCEPTED', bookingStatus: 'TRIP_BOOK_OPERATION_DRIVER_CONFIRMED', category: 'Driver confirm', visibleTo: ALL },
  { tripStatus: 'TRIP_BOOK_ASSIGNED', bookingStatus: 'TRIP_BOOK_RIDER_CONFIRMED', category: 'Assignment (special)', visibleTo: ALL },
];
