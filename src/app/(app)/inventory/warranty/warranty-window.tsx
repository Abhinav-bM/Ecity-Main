'use client'

import { useRouter } from 'next/navigation'
import { AppSelect } from '@/components/app-select'

/** How far ahead to look. In the URL, so the view can be shared. */
export function WarrantyWindow({ value }: { value: string }) {
  const router = useRouter()
  return (
    <div className="max-w-xs">
      <AppSelect
        id="days"
        label="Expiring within"
        value={value}
        onValueChange={(v) => router.push(`/inventory/warranty?days=${v}`)}
        options={[
          { value: '7', label: 'Next 7 days' },
          { value: '30', label: 'Next 30 days' },
          { value: '60', label: 'Next 60 days' },
          { value: '90', label: 'Next 90 days' },
          { value: '365', label: 'Next year' },
        ]}
      />
    </div>
  )
}
