import { Icon } from '../shared/Icon';

const SECURITY_LAYERS = [
  {
    layer: 'Authentication',
    items: [
      { control: 'JWT token validation on all endpoints', status: 'active' },
      { control: 'Role-based access: rider endpoints require rider token, driver endpoints require driver token', status: 'active' },
      { control: 'Trip ownership check: rider can only update their own trips', status: 'active' },
    ],
  },
  {
    layer: 'Authorization',
    items: [
      { control: 'VALID_RIDER_TRANSITIONS map restricts which statuses a rider can set', status: 'active' },
      { control: 'VALID_DRIVER_TRANSITIONS map restricts which statuses a driver can set', status: 'active' },
      { control: 'Terminal status guard prevents modifications to completed/cancelled bookings', status: 'active' },
    ],
  },
  {
    layer: 'Data Integrity',
    items: [
      { control: 'Optimistic locking via updateOne with booking_status guard', status: 'active' },
      { control: 'booking_status_history array provides audit trail', status: 'active' },
      { control: 'is_booked flag check prevents non-scheduled trips from using booking endpoints', status: 'active' },
    ],
  },
  {
    layer: 'Input Validation',
    items: [
      { control: 'Booking status value validated against enum (Joi/express-validator)', status: 'active' },
      { control: 'Trip ID format validation (MongoDB ObjectId)', status: 'active' },
      { control: 'Request body schema validation on booking status endpoints', status: 'active' },
    ],
  },
  {
    layer: 'Rate Limiting',
    items: [
      { control: 'API gateway rate limiting on booking endpoints', status: 'active' },
      { control: 'BullMQ job deduplication prevents duplicate scheduling', status: 'active' },
      { control: 'Notification throttling via sendBookingNotificationWithConfig', status: 'active' },
    ],
  },
];

export function SecuritySection() {
  return (
    <div className="space-y-4">
      {SECURITY_LAYERS.map((layer) => (
        <div
          key={layer.layer}
          className="rounded-xl border overflow-hidden"
          style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
        >
          <div
            className="px-4 py-2.5 border-b flex items-center gap-2"
            style={{ borderColor: 'var(--color-border-default)', background: 'rgba(255,255,255,0.03)' }}
          >
            <Icon name="shield" size={16} className="text-emerald-400" />
            <span className="text-sm font-bold text-slate-200">{layer.layer}</span>
          </div>
          <ul className="p-3 space-y-1.5">
            {layer.items.map((item) => (
              <li key={item.control} className="flex items-center gap-2 px-1">
                <Icon name="check_circle" size={14} className="text-emerald-400 shrink-0" />
                <span className="text-xs text-slate-400">{item.control}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
