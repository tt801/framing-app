import { createHandler } from '../../admin/server/platform/supplier-products.js'
import * as platformAdmin from '../lib/platformAdmin.js'
export default createHandler({ ...platformAdmin, requirePlatformAdmin: platformAdmin.requireConfiguredPlatformAdmin })
