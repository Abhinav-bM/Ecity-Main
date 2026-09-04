import { Badge } from '@/components/ui/badge'
import type { MainType } from '@/server/db/schema'

/**
 * The five main types, shown consistently everywhere (PRD §5.1).
 *
 * ER and ACT are the shop's own terms — the system stores the codes and never
 * needs to know what they stand for. Change these labels here and they change
 * everywhere; nothing else depends on the wording.
 */
export const MAIN_TYPE_LABEL: Record<MainType, string> = {
  NEW: 'NEW',
  USED: 'USED',
  ER: 'ER',
  ACT: 'ACT',
  GLOBAL: 'GLOBAL',
}

const VARIANT: Record<MainType, 'default' | 'secondary' | 'outline' | 'muted' | 'warning'> = {
  NEW: 'default',
  USED: 'secondary',
  ER: 'outline',
  ACT: 'outline',
  GLOBAL: 'muted',
}

/**
 * NEW CUT is a designation INSIDE GLOBAL, never a sixth type, so it renders as
 * a second badge beside GLOBAL rather than replacing it.
 */
export function MainTypeBadge({
  mainType,
  isNewCut,
}: {
  mainType: MainType
  isNewCut?: boolean
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge variant={VARIANT[mainType]} className="font-mono text-[11px]">
        {MAIN_TYPE_LABEL[mainType]}
      </Badge>
      {isNewCut ? (
        <Badge variant="warning" className="font-mono text-[11px]">
          NEW CUT
        </Badge>
      ) : null}
    </span>
  )
}

export const DEVICE_STATUS_LABEL: Record<string, string> = {
  IN_STOCK: 'In stock',
  RESERVED: 'Reserved',
  SOLD: 'Sold',
  SOLD_PENDING_IMPORT: 'Sold (awaiting import)',
  RETURNED: 'Returned — inspection',
  DAMAGED: 'Damaged',
  LOST: 'Lost',
  REPAIR: 'Repair',
  IN_TRANSIT: 'In transit',
}

export function DeviceStatusBadge({ status }: { status: string }) {
  const variant =
    status === 'IN_STOCK'
      ? 'success'
      : status === 'SOLD'
        ? 'secondary'
        : status === 'DAMAGED' || status === 'LOST'
          ? 'destructive'
          : 'muted'
  return <Badge variant={variant}>{DEVICE_STATUS_LABEL[status] ?? status}</Badge>
}
