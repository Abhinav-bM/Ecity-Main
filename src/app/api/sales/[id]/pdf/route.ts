import { getInvoiceData } from '@/server/services/invoice'
import { renderInvoicePdf } from '@/server/pdf/invoice-pdf'
import { AppError, route } from '@/server/http'

/** PRD FR-26.4. Rendered on the server so the file is identical everywhere. */
export const GET = route({ permission: 'sale.view', branchFrom: 'none' }, async ({ user, params }) => {
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid sale id.', 400)

  // getInvoiceData goes through getSale, which enforces the branch scope.
  const data = await getInvoiceData(user, id)
  const pdf = await renderInvoicePdf(data)
  const filename = `${data.invoiceNumber.replace(/[^A-Za-z0-9._-]/g, '-')}.pdf`

  return new Response(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, no-store',
    },
  })
})
