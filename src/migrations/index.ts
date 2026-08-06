import * as migration_20260730_215819_init_tenancy from './20260730_215819_init_tenancy'
import * as migration_20260730_222708_add_audit_events from './20260730_222708_add_audit_events'
import * as migration_20260730_224419_add_releases_channels from './20260730_224419_add_releases_channels'
import * as migration_20260803_133059_audit_logout_action from './20260803_133059_audit_logout_action'
import * as migration_20260803_140000_release_number_unique from './20260803_140000_release_number_unique'
import * as migration_20260803_143926_add_outbox from './20260803_143926_add_outbox'
import * as migration_20260803_150837_add_delivery_keys from './20260803_150837_add_delivery_keys'
import * as migration_20260805_113731_add_stream_and_media from './20260805_113731_add_stream_and_media'
import * as migration_20260805_120000_stream_slug_unique from './20260805_120000_stream_slug_unique'
import * as migration_20260805_130521_add_videos_and_promos from './20260805_130521_add_videos_and_promos'
import * as migration_20260805_131000_video_promo_unique from './20260805_131000_video_promo_unique'
import * as migration_20260805_134523_add_tenant_public_url from './20260805_134523_add_tenant_public_url'
import * as migration_20260805_151838_add_stream_locale from './20260805_151838_add_stream_locale'
import * as migration_20260805_165949_add_search_text from './20260805_165949_add_search_text'
import * as migration_20260806_102334_add_design_tokens from './20260806_102334_add_design_tokens'
import * as migration_20260806_103000_design_token_unique from './20260806_103000_design_token_unique'
import * as migration_20260806_113842_add_pages from './20260806_113842_add_pages'
import * as migration_20260806_114500_page_path_unique from './20260806_114500_page_path_unique'
import * as migration_20260806_115914_add_global_areas from './20260806_115914_add_global_areas'

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
  {
    up: migration_20260805_113731_add_stream_and_media.up,
    down: migration_20260805_113731_add_stream_and_media.down,
    name: '20260805_113731_add_stream_and_media',
  },
  {
    up: migration_20260805_120000_stream_slug_unique.up,
    down: migration_20260805_120000_stream_slug_unique.down,
    name: '20260805_120000_stream_slug_unique',
  },
  {
    up: migration_20260805_130521_add_videos_and_promos.up,
    down: migration_20260805_130521_add_videos_and_promos.down,
    name: '20260805_130521_add_videos_and_promos',
  },
  {
    up: migration_20260805_131000_video_promo_unique.up,
    down: migration_20260805_131000_video_promo_unique.down,
    name: '20260805_131000_video_promo_unique',
  },
  {
    up: migration_20260805_134523_add_tenant_public_url.up,
    down: migration_20260805_134523_add_tenant_public_url.down,
    name: '20260805_134523_add_tenant_public_url',
  },
  {
    up: migration_20260805_151838_add_stream_locale.up,
    down: migration_20260805_151838_add_stream_locale.down,
    name: '20260805_151838_add_stream_locale',
  },
  {
    up: migration_20260805_165949_add_search_text.up,
    down: migration_20260805_165949_add_search_text.down,
    name: '20260805_165949_add_search_text',
  },
  {
    up: migration_20260806_102334_add_design_tokens.up,
    down: migration_20260806_102334_add_design_tokens.down,
    name: '20260806_102334_add_design_tokens',
  },
  {
    up: migration_20260806_103000_design_token_unique.up,
    down: migration_20260806_103000_design_token_unique.down,
    name: '20260806_103000_design_token_unique',
  },
  {
    up: migration_20260806_113842_add_pages.up,
    down: migration_20260806_113842_add_pages.down,
    name: '20260806_113842_add_pages',
  },
  {
    up: migration_20260806_114500_page_path_unique.up,
    down: migration_20260806_114500_page_path_unique.down,
    name: '20260806_114500_page_path_unique',
  },
  {
    up: migration_20260806_115914_add_global_areas.up,
    down: migration_20260806_115914_add_global_areas.down,
    name: '20260806_115914_add_global_areas',
  },
]
