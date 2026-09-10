"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { MAIN_TYPE_LABEL } from "@/components/main-type-badge";
import type { MainType } from "@/server/db/schema";
import { apiBlob } from '@/lib/api'

export type InvoiceData = {
  invoiceNumber: string;
  soldAt: Date | string;
  pricesIncludedTax: boolean;
  /**
   * Was the shop registered for GST when this bill was issued? Stamped on the
   * sale, so a reprint shows the document that was actually issued rather than
   * whatever the shop is registered as today.
   */
  gstEnabled: boolean;
  business: {
    name: string;
    addressLine1: string | null;
    city: string | null;
    phone: string | null;
    gstin: string | null;
  };
  branch: { name: string; code: string };
  /** Statutory GST detail (PRD OQ-4, resolved: compliant invoices required). */
  gst: {
    placeOfSupplyCode: string | null;
    placeOfSupplyName: string | null;
    isInterState: boolean;
    cgstPaise: bigint;
    sgstPaise: bigint;
    igstPaise: bigint;
    hsnSummary: {
      hsnCode: string;
      rateBasisPoints: number;
      quantity: number;
      taxablePaise: bigint;
      taxPaise: bigint;
      cgstPaise: bigint;
      sgstPaise: bigint;
      igstPaise: bigint;
    }[];
  };
  customer: { name: string; phone: string | null; gstin: string | null } | null;
  items: {
    id: number;
    description: string | null;
    identifierSnapshot: string | null;
    /** M10 FR-36.4. The last hop of Business → Branch → Transaction → IMEI. */
    deviceId: number | null;
    hsnCodeSnapshot: string | null;
    mainTypeSnapshot: MainType | null;
    isNewCutSnapshot: boolean;
    quantity: number;
    unitPricePaise: bigint;
    discountPaise: bigint;
    taxRateBasisPoints: number;
    taxablePaise: bigint;
    taxPaise: bigint;
    cgstPaise: bigint;
    sgstPaise: bigint;
    igstPaise: bigint;
    lineTotalPaise: bigint;
  }[];
  payments: {
    id: number;
    methodName: string;
    amountPaise: bigint;
    reference: string | null;
  }[];
  /**
   * PRD FR-9.2. Shown under the total as settlement, never as a discount - the
   * goods were sold at the full price and GST is charged on that.
   */
  tradeIns: {
    id: number;
    deviceId: number | null;
    agreedValuePaise: bigint;
    identifier: string | null;
  }[];
  subtotalPaise: bigint;
  discountPaise: bigint;
  taxablePaise: bigint;
  taxPaise: bigint;
  totalPaise: bigint;
  paidPaise: bigint;
};

/**
 * The invoice (PRD FR-26.1, FR-26.4).
 *
 * One document, two print formats: A4 for a filed copy and 80 mm for the
 * counter's thermal printer. Printing is the browser's own pipeline, which
 * avoids running headless Chrome on the server (docs/03 §5).
 */
export function Invoice({
  data,
  saleId,
}: {
  data: InvoiceData;
  saleId: number;
}) {
  const [busy, setBusy] = useState(false);

  function print(format: "a4" | "thermal") {
    setBusy(true);
    document.documentElement.setAttribute("data-print", format);
    // Let the layout settle before the print dialog snapshots it.
    requestAnimationFrame(() => {
      window.print();
      document.documentElement.removeAttribute("data-print");
      setBusy(false);
    });
  }

  const taxByRate = new Map<
    number,
    { taxable: bigint; tax: bigint; cgst: bigint; sgst: bigint; igst: bigint }
  >();
  for (const i of data.items) {
    const bucket = taxByRate.get(i.taxRateBasisPoints) ?? {
      taxable: 0n,
      tax: 0n,
      cgst: 0n,
      sgst: 0n,
      igst: 0n,
    };
    bucket.taxable += i.taxablePaise;
    bucket.tax += i.taxPaise;
    bucket.cgst += i.cgstPaise;
    bucket.sgst += i.sgstPaise;
    bucket.igst += i.igstPaise;
    taxByRate.set(i.taxRateBasisPoints, bucket);
  }
  const due = data.totalPaise - data.paidPaise;

  return (
    <>
      <div className="no-print flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => print("a4")}
        >
          Print A4
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => print("thermal")}
        >
          Print receipt (80 mm)
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={`/api/sales/${saleId}/pdf`}>Download PDF</a>
        </Button>
        <ShareButton saleId={saleId} invoiceNumber={data.invoiceNumber} />
      </div>

      <div id="invoice" className="rounded-lg border bg-card p-6 text-sm">
        <header className="mb-4 border-b pb-3">
          {/* An unregistered dealer must not issue a "Tax Invoice", and must
              not show a GSTIN. */}
          <p className="text-[11px] tracking-wide uppercase text-muted-foreground">
            {data.gstEnabled ? "Tax Invoice" : "Invoice"}
          </p>
          <h2 className="text-base font-semibold">{data.business.name}</h2>
          {data.business.addressLine1 ? (
            <p>{data.business.addressLine1}</p>
          ) : null}
          <p className="text-muted-foreground">
            {[data.business.city, data.business.phone]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {data.gstEnabled && data.business.gstin ? (
            <p className="font-mono text-xs">GSTIN {data.business.gstin}</p>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">
            {data.branch.name} ({data.branch.code})
          </p>
          {data.gstEnabled && data.gst.placeOfSupplyCode ? (
            <p className="text-xs text-muted-foreground">
              Place of supply: {data.gst.placeOfSupplyCode}
              {data.gst.placeOfSupplyName
                ? ` ${data.gst.placeOfSupplyName}`
                : ""}
            </p>
          ) : null}
        </header>

        <div className="mb-3 flex flex-wrap justify-between gap-2">
          <div>
            <p className="font-mono font-medium">{data.invoiceNumber}</p>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(data.soldAt)}
            </p>
          </div>
          <div className="text-right">
            <p className="font-medium">
              {data.customer?.name ?? "Walk-in customer"}
            </p>
            {data.customer?.phone ? (
              <p className="text-xs text-muted-foreground">
                {data.customer.phone}
              </p>
            ) : null}
            {data.customer?.gstin ? (
              <p className="font-mono text-xs">GSTIN {data.customer.gstin}</p>
            ) : null}
          </div>
        </div>

        {/* Wide content scrolls inside its own box; the page never does. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[22rem]">
            <thead className="border-y">
              <tr className="text-left text-xs uppercase">
                <th className="py-1">Item</th>
                {data.gstEnabled ? (
                  <th className="a4-only py-1 text-right">HSN</th>
                ) : null}
                <th className="py-1 text-right">Qty</th>
                <th className="py-1 text-right">Price</th>
                {data.gstEnabled ? (
                  <th className="a4-only py-1 text-right">Tax</th>
                ) : null}
                <th className="py-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id} className="border-b align-top">
                  <td className="py-1.5">
                    {i.description}
                    {i.identifierSnapshot ? (
                      <span className="block font-mono text-[11px] text-muted-foreground">
                        {/*
                          On screen the IMEI is the way into the handset's
                          history; on paper it is just the number, because a
                          printed invoice has nowhere to click.
                        */}
                        {i.deviceId ? (
                          <a
                            href={`/devices/${i.deviceId}`}
                            className="underline-offset-4 hover:underline print:no-underline"
                          >
                            {i.identifierSnapshot}
                          </a>
                        ) : (
                          i.identifierSnapshot
                        )}
                      </span>
                    ) : null}
                    {i.mainTypeSnapshot ? (
                      <span className="block text-[11px] text-muted-foreground">
                        {MAIN_TYPE_LABEL[i.mainTypeSnapshot]}
                        {i.isNewCutSnapshot ? " · NEW CUT" : ""}
                      </span>
                    ) : null}
                  </td>
                  {data.gstEnabled ? (
                    <td className="a4-only tabular py-1.5 text-right text-xs">
                      {i.hsnCodeSnapshot ?? "—"}
                    </td>
                  ) : null}
                  <td className="tabular py-1.5 text-right">{i.quantity}</td>
                  <td className="tabular py-1.5 text-right">
                    {formatMoney(i.unitPricePaise)}
                  </td>
                  {data.gstEnabled ? (
                    <td className="a4-only tabular py-1.5 text-right">
                      {formatMoney(i.taxPaise)}
                    </td>
                  ) : null}
                  <td className="tabular py-1.5 text-right">
                    {formatMoney(i.lineTotalPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex justify-end">
          <dl className="grid w-56 grid-cols-2 gap-0.5">
            {/* Without GST there is no "taxable value" - it is just the total. */}
            {data.gstEnabled ? (
              <>
                <dt className="text-muted-foreground">Taxable</dt>
                <dd className="tabular text-right">
                  {formatMoney(data.taxablePaise)}
                </dd>
              </>
            ) : null}
            {/*
              Intra-state supply must show CGST and SGST separately; only an
              inter-state supply is billed as a single IGST line.
            */}
            {data.gstEnabled &&
              [...taxByRate.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([bp, v]) =>
                  data.gst.isInterState ? (
                    <div
                      key={bp}
                      className="col-span-2 grid grid-cols-2 gap-0.5"
                    >
                      <dt className="text-muted-foreground">
                        IGST {bp / 100}%
                      </dt>
                      <dd className="tabular text-right">
                        {formatMoney(v.igst)}
                      </dd>
                    </div>
                  ) : (
                    <div
                      key={bp}
                      className="col-span-2 grid grid-cols-2 gap-0.5"
                    >
                      <dt className="text-muted-foreground">
                        CGST {bp / 200}%
                      </dt>
                      <dd className="tabular text-right">
                        {formatMoney(v.cgst)}
                      </dd>
                      <dt className="text-muted-foreground">
                        SGST {bp / 200}%
                      </dt>
                      <dd className="tabular text-right">
                        {formatMoney(v.sgst)}
                      </dd>
                    </div>
                  ),
                )}
            <dt className="border-t pt-1 font-medium">Total</dt>
            <dd className="tabular border-t pt-1 text-right font-medium">
              {formatMoney(data.totalPaise)}
            </dd>
            {data.tradeIns.map((t) => (
              <div key={t.id} className="col-span-2 grid grid-cols-2 gap-0.5">
                <dt className="text-muted-foreground">
                  Trade-in{t.identifier ? ` · ${t.identifier}` : ""}
                </dt>
                <dd className="tabular text-right">
                  {formatMoney(t.agreedValuePaise)}
                </dd>
              </div>
            ))}
            {data.payments.map((p) => (
              <div key={p.id} className="col-span-2 grid grid-cols-2 gap-0.5">
                <dt className="text-muted-foreground">{p.methodName}</dt>
                <dd className="tabular text-right">
                  {formatMoney(p.amountPaise)}
                </dd>
              </div>
            ))}
            {due > 0n ? (
              <>
                <dt className="font-medium">Balance due</dt>
                <dd className="tabular text-right font-medium">
                  {formatMoney(due)}
                </dd>
              </>
            ) : null}
          </dl>
        </div>

        {data.gstEnabled && data.gst.hsnSummary.length > 0 ? (
          <div className="a4-only mt-4">
            <p className="mb-1 text-xs font-medium">HSN summary</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[26rem] text-xs">
                <thead className="border-y">
                  <tr className="text-left uppercase">
                    <th className="py-1">HSN</th>
                    <th className="py-1 text-right">Qty</th>
                    <th className="py-1 text-right">Taxable</th>
                    {data.gst.isInterState ? (
                      <th className="py-1 text-right">IGST</th>
                    ) : (
                      <>
                        <th className="py-1 text-right">CGST</th>
                        <th className="py-1 text-right">SGST</th>
                      </>
                    )}
                    <th className="py-1 text-right">Total tax</th>
                  </tr>
                </thead>
                <tbody>
                  {data.gst.hsnSummary.map((r) => (
                    <tr
                      key={`${r.hsnCode}-${r.rateBasisPoints}`}
                      className="border-b"
                    >
                      <td className="py-1 font-mono">{r.hsnCode}</td>
                      <td className="tabular py-1 text-right">{r.quantity}</td>
                      <td className="tabular py-1 text-right">
                        {formatMoney(r.taxablePaise)}
                      </td>
                      {data.gst.isInterState ? (
                        <td className="tabular py-1 text-right">
                          {formatMoney(r.igstPaise)}
                        </td>
                      ) : (
                        <>
                          <td className="tabular py-1 text-right">
                            {formatMoney(r.cgstPaise)}
                          </td>
                          <td className="tabular py-1 text-right">
                            {formatMoney(r.sgstPaise)}
                          </td>
                        </>
                      )}
                      <td className="tabular py-1 text-right">
                        {formatMoney(r.taxPaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <footer className="mt-4 border-t pt-2 text-center text-[11px] text-muted-foreground">
          {data.gstEnabled
            ? `${data.pricesIncludedTax ? "Prices include GST." : "GST added as shown."} `
            : ""}
          Thank you.
        </footer>
      </div>
    </>
  );
}

/**
 * PRD FR-26.4 - send the invoice to the customer.
 *
 * On a phone this hands the PDF to the OS share sheet, which is how a
 * salesperson actually gets a bill to someone: WhatsApp, mail, whatever they
 * use. Desktop browsers mostly cannot share a file, so there it copies a link
 * instead of showing a button that would do nothing.
 */
function ShareButton({
  saleId,
  invoiceNumber,
}: {
  saleId: number;
  invoiceNumber: string;
}) {
  const [busy, setBusy] = useState(false);

  async function share() {
    setBusy(true);
    try {
      const res = await apiBlob(`/api/sales/${saleId}/pdf`);
      if (!res.ok) throw new Error(res.error);
      const blob = res.blob;
      const file = new File(
        [blob],
        `${invoiceNumber.replace(/[^A-Za-z0-9._-]/g, "-")}.pdf`,
        {
          type: "application/pdf",
        },
      );

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Invoice ${invoiceNumber}`,
        });
        return;
      }

      // No file sharing here - fall back to the link, which is still useful.
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Invoice link copied.");
    } catch (error) {
      // An abort is the user closing the share sheet, not a failure.
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(
        error instanceof Error ? error.message : "Could not share the invoice.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={() => void share()}
    >
      <Share2 className="size-4" />
      {busy ? "Preparing…" : "Share"}
    </Button>
  );
}
