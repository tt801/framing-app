import { createHandler } from '../../server/platform/suppliers.js'
import * as platformAdmin from '../../server/platform/platformAdmin.js'
export default createHandler({ ...platformAdmin, requirePlatformAdmin: platformAdmin.requireConfiguredPlatformAdmin })
