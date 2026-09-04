import { partyRoutes } from '@/server/party-routes'

const routes = partyRoutes('customer')
export const GET = routes.get
export const PATCH = routes.update
