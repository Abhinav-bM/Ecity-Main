'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { MAIN_TYPES } from '@/lib/validation'

/**
 * PRD FR-22. Filter by main type, and NEW CUT *within* GLOBAL.
 *
 * NEW CUT is only offered once GLOBAL is chosen, because it is a designation
 * inside GLOBAL and never a type of its own — the rule made visible rather
 * than only enforced.
 */
export function MainTypeFilter({ mainType, newCut }: { mainType: string; newCut: string }) {
  const router = useRouter()
  const params = useSearchParams()

  function go(next: Record<string, string>) {
    const q = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v)
      else q.delete(k)
    }
    router.push(`/analytics/profit?${q.toString()}`)
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-2 py-3">
        <span className="text-xs text-muted-foreground">Main type</span>
        <Button
          variant={mainType ? 'outline' : 'default'}
          size="sm"
          onClick={() => go({ mainType: '', newCut: '' })}
        >
          All
        </Button>
        {MAIN_TYPES.map((t) => (
          <Button
            key={t}
            variant={mainType === t ? 'default' : 'outline'}
            size="sm"
            onClick={() => go({ mainType: t, newCut: t === 'GLOBAL' ? newCut : '' })}
          >
            {t}
          </Button>
        ))}

        {mainType === 'GLOBAL' ? (
          <span className="flex items-center gap-2 border-l pl-2" data-testid="new-cut-filter">
            <span className="text-xs text-muted-foreground">within GLOBAL</span>
            <Button
              variant={newCut === '1' ? 'default' : 'outline'}
              size="sm"
              onClick={() => go({ newCut: newCut === '1' ? '' : '1' })}
            >
              NEW CUT only
            </Button>
            <Button
              variant={newCut === '0' ? 'default' : 'outline'}
              size="sm"
              onClick={() => go({ newCut: newCut === '0' ? '' : '0' })}
            >
              Not NEW CUT
            </Button>
          </span>
        ) : null}
      </CardContent>
    </Card>
  )
}
