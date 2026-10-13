import { createHandler } from '../../server/platform/supplier-feeds.js'
import * as platformAdmin from '../../server/platform/platformAdmin.js'
export default createHandler({ ...platformAdmin, requirePlatformAdmin: platformAdmin.requireConfiguredPlatformAdmin })
