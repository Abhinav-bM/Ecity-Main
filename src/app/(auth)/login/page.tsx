import { redirect } from 'next/navigation'
import { getSessionContext } from '@/server/auth/session'
import { LoginForm } from './login-form'

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  if (await getSessionContext()) redirect('/dashboard')
  return <LoginForm />
}
