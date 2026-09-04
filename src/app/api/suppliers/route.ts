import { partyRoutes } from '@/server/party-routes'

const routes = partyRoutes('supplier')
export const GET = routes.list
export const POST = routes.create
