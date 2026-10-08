import { createHandler } from '../../admin/server/platform/suppliers.js'
import * as platformAdmin from '../lib/platformAdmin.js'
export default createHandler({ ...platformAdmin, requirePlatformAdmin: platformAdmin.requireConfiguredPlatformAdmin })
