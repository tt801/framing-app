import { createCheckHandler } from '../../server/platform/supplier-feed-checks.js'
import * as platformAdmin from '../../server/platform/platformAdmin.js'

export const config = { maxDuration: 300 }
export default createCheckHandler(platformAdmin, 'scheduled')
