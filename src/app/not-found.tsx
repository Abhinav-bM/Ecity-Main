import Link from 'next/link'
import { FileQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * What a record that is not there looks like.
 *
 * Reached both by a mistyped address and - more often - by a link to something
 * that has since been voided or deleted, or that belongs to a branch this user
 * cannot see. Those are the same answer on purpose: telling someone a record
 * exists but is not theirs is itself a disclosure.
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg p-6">
      <Card>
        <CardContent className="space-y-4 py-6">
          <div className="flex items-start gap-3">
            <FileQuestion className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <h1 className="text-base font-semibold tracking-tight">Not found</h1>
              <p className="text-sm text-muted-foreground">
                This record does not exist, or it is not one you have access to. It may have been
                voided or deleted since the link was made.
              </p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard">Back to the dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
