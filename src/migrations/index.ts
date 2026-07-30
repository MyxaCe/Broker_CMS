import * as migration_20260730_215819_init_tenancy from './20260730_215819_init_tenancy'
import * as migration_20260730_222708_add_audit_events from './20260730_222708_add_audit_events'

export const migrations = [
  {
    up: migration_20260730_215819_init_tenancy.up,
    down: migration_20260730_215819_init_tenancy.down,
    name: '20260730_215819_init_tenancy',
  },
  {
    up: migration_20260730_222708_add_audit_events.up,
    down: migration_20260730_222708_add_audit_events.down,
    name: '20260730_222708_add_audit_events',
  },
]
