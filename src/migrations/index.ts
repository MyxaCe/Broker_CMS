import * as migration_20260730_215819_init_tenancy from './20260730_215819_init_tenancy'
import * as migration_20260730_222708_add_audit_events from './20260730_222708_add_audit_events'
import * as migration_20260730_224419_add_releases_channels from './20260730_224419_add_releases_channels'
import * as migration_20260803_133059_audit_logout_action from './20260803_133059_audit_logout_action'
import * as migration_20260803_140000_release_number_unique from './20260803_140000_release_number_unique'
import * as migration_20260803_143926_add_outbox from './20260803_143926_add_outbox'
import * as migration_20260803_150837_add_delivery_keys from './20260803_150837_add_delivery_keys'

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
  {
    up: migration_20260730_224419_add_releases_channels.up,
    down: migration_20260730_224419_add_releases_channels.down,
    name: '20260730_224419_add_releases_channels',
  },
  {
    up: migration_20260803_133059_audit_logout_action.up,
    down: migration_20260803_133059_audit_logout_action.down,
    name: '20260803_133059_audit_logout_action',
  },
  {
    up: migration_20260803_140000_release_number_unique.up,
    down: migration_20260803_140000_release_number_unique.down,
    name: '20260803_140000_release_number_unique',
  },
  {
    up: migration_20260803_143926_add_outbox.up,
    down: migration_20260803_143926_add_outbox.down,
    name: '20260803_143926_add_outbox',
  },
  {
    up: migration_20260803_150837_add_delivery_keys.up,
    down: migration_20260803_150837_add_delivery_keys.down,
    name: '20260803_150837_add_delivery_keys',
  },
]
