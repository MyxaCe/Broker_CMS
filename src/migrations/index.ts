import * as migration_20260730_215819_init_tenancy from './20260730_215819_init_tenancy'

export const migrations = [
  {
    up: migration_20260730_215819_init_tenancy.up,
    down: migration_20260730_215819_init_tenancy.down,
    name: '20260730_215819_init_tenancy',
  },
]
