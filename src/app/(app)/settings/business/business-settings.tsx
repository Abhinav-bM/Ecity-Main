"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";
import { businessProfileSchema, toPercent } from "@/lib/validation";
import type {
  Business,
  ExpenseCategory,
  PaymentMethod,
  TaxRate,
} from "@/server/db/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormStateCodeSelect } from "@/components/state-code-select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field } from "@/components/form-field";
import { AppSelect, FormSelect } from "@/components/app-select";
import { FormError } from '@/components/form-error'
import { apiFetch } from '@/lib/api'

type ProfileValues = z.infer<typeof businessProfileSchema>;

/** The enum spells these EXTERNAL and ECITY; a shopkeeper does not. */
const CHANNEL_LABEL: Record<string, string> = {
  EXTERNAL: "the other system",
  ECITY: "this till",
  BOTH: "both systems",
};

export function BusinessSettings({
  business,
  taxRates,
  paymentMethods,
  expenseCategories,
  canManage,
}: {
  business: Business;
  taxRates: TaxRate[];
  paymentMethods: PaymentMethod[];
  expenseCategories: ExpenseCategory[];
  canManage: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
          Business settings
        </h1>
        <p className="text-sm text-muted-foreground">
          These drive the pickers and totals used by billing, purchases and
          expenses.
        </p>
      </div>

      <Tabs defaultValue="profile">
        {/* Scrolls rather than wraps on a phone. */}
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          {/* Nothing to manage when the shop charges no tax. */}
          {business.gstEnabled ? <TabsTrigger value="tax">Tax</TabsTrigger> : null}
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4">
          <ProfileForm business={business} canManage={canManage} />
        </TabsContent>
        {business.gstEnabled ? (
          <TabsContent value="tax" className="mt-4">
            <TaxRates rates={taxRates} canManage={canManage} />
          </TabsContent>
        ) : null}
        <TabsContent value="payments" className="mt-4">
          <PaymentMethods methods={paymentMethods} canManage={canManage} />
        </TabsContent>
        <TabsContent value="expenses" className="mt-4">
          <ExpenseCategories
            categories={expenseCategories}
            canManage={canManage}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProfileForm({
  business,
  canManage,
}: {
  business: Business;
  canManage: boolean;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [includeTax, setIncludeTax] = useState(business.pricesIncludeTax);
  const [gstOn, setGstOn] = useState(business.gstEnabled);

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfileValues>({
    resolver: zodResolver(businessProfileSchema),
    defaultValues: {
      name: business.name,
      legalName: business.legalName ?? "",
      email: business.email ?? "",
      phone: business.phone ?? "",
      addressLine1: business.addressLine1 ?? "",
      addressLine2: business.addressLine2 ?? "",
      city: business.city ?? "",
      state: business.state ?? "",
      pincode: business.pincode ?? "",
      gstin: business.gstin ?? "",
      defaultCreditDays: business.defaultCreditDays,
      newStockSalesChannel: business.newStockSalesChannel,
      stateCode: business.stateCode ?? "",
      currency: business.currency,
      timezone: business.timezone,
      pricesIncludeTax: business.pricesIncludeTax,
      gstEnabled: business.gstEnabled,
      invoicePrefix: business.invoicePrefix,
      imeiSlots: business.imeiSlots,
    },
  });

  /**
   * A rejected form must say why, never just do nothing. The specific
   * message lives on the field; this only says that something is wrong,
   * so the two do not duplicate each other.
   */
  function onInvalid() {
    setFormError("Please check the highlighted fields.");
  }

  async function onSubmit(values: ProfileValues) {
    setFormError(null);
    const res = await apiFetch("/api/business", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...values,
        pricesIncludeTax: includeTax,
        gstEnabled: gstOn,
      }),
    });
    if (!res.ok) {
      setFormError(res.error);
      return;
    }

    /*
     * Say what moved. Changing where NEW stock is billed also re-channels the
     * handsets already on the shelf, and a silent success is exactly why this
     * looked broken before — the shop flipped the switch and saw nothing.
     */
    const { restamped = 0 } = (res.data) as { restamped?: number };
    toast.success(
      restamped > 0
        ? `Saved. ${restamped} NEW handset${restamped === 1 ? "" : "s"} in stock moved to ${CHANNEL_LABEL[values.newStockSalesChannel] ?? values.newStockSalesChannel}.`
        : "Business profile saved.",
    );
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit, onInvalid)}
      className="space-y-4"
      noValidate
    >
      <FormError message={formError} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Profile</CardTitle>
          <CardDescription>
            Appears on every invoice and receipt.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            id="name"
            label="Business name"
            required
            error={errors.name?.message}
          >
            <Input id="name" disabled={!canManage} {...register("name")} />
          </Field>
          <Field
            id="legalName"
            label="Legal name"
            error={errors.legalName?.message}
          >
            <Input
              id="legalName"
              disabled={!canManage}
              {...register("legalName")}
            />
          </Field>
          <Field id="phone" label="Phone" error={errors.phone?.message}>
            <Input
              id="phone"
              type="tel"
              disabled={!canManage}
              {...register("phone")}
            />
          </Field>
          <Field id="email" label="Email" error={errors.email?.message}>
            <Input
              id="email"
              type="email"
              disabled={!canManage}
              {...register("email")}
            />
          </Field>
          {gstOn ? (
            <>
              <Field
                id="gstin"
                label="GST number"
                error={errors.gstin?.message}
              >
                <Input
                  id="gstin"
                  className="uppercase"
                  disabled={!canManage}
                  {...register("gstin")}
                />
              </Field>
              <Field
                id="stateCode"
                label="GST state"
                error={errors.stateCode?.message}
                hint="Where the shop is registered. Sets the default place of supply."
              >
                <FormStateCodeSelect
                  control={control}
                  name="stateCode"
                  id="stateCode"
                  disabled={!canManage}
                />
              </Field>
            </>
          ) : null}
          <Field
            id="invoicePrefix"
            label="Invoice prefix"
            error={errors.invoicePrefix?.message}
          >
            <Input
              id="invoicePrefix"
              className="uppercase"
              disabled={!canManage}
              {...register("invoicePrefix")}
            />
          </Field>
          <Field
            id="addressLine1"
            label="Address"
            className="sm:col-span-2"
            error={errors.addressLine1?.message}
          >
            <Input
              id="addressLine1"
              disabled={!canManage}
              {...register("addressLine1")}
            />
          </Field>
          <Field id="city" label="City" error={errors.city?.message}>
            <Input id="city" disabled={!canManage} {...register("city")} />
          </Field>
          <Field id="state" label="State" error={errors.state?.message}>
            <Input id="state" disabled={!canManage} {...register("state")} />
          </Field>
          <Field
            id="currency"
            label="Currency"
            hint="Single currency per business"
          >
            <Input
              id="currency"
              disabled
              className="uppercase"
              {...register("currency")}
            />
          </Field>
          <Field
            id="timezone"
            label="Timezone"
            error={errors.timezone?.message}
          >
            <Input
              id="timezone"
              disabled={!canManage}
              {...register("timezone")}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Device identifiers</CardTitle>
          <CardDescription>
            How many IMEI fields the device and purchase forms show. A dual-SIM
            phone has two. This changes the forms only — stored devices, search,
            imports and reports always handle every identifier a device has,
            whatever this is set to.
          </CardDescription>
        </CardHeader>
        <CardContent className="max-w-xs">
          <Field
            id="imeiSlots"
            label="IMEI fields per device"
            error={errors.imeiSlots?.message}
            hint="1 to 4. Takes effect immediately — no deployment needed."
          >
            <Input
              id="imeiSlots"
              inputMode="numeric"
              disabled={!canManage}
              {...register("imeiSlots")}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">GST</CardTitle>
          <CardDescription>
            Turn this off if the shop is not registered for GST. Nothing is
            deleted — switch it back on when you register and every GST field
            returns.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3">
            <Switch
              id="gstEnabled"
              checked={gstOn}
              onCheckedChange={setGstOn}
              disabled={!canManage}
            />
            <div className="space-y-0.5">
              <Label htmlFor="gstEnabled">Registered for GST</Label>
              <p className="text-xs text-muted-foreground">
                {gstOn
                  ? "Bills are tax invoices: tax is charged, and HSN, GSTIN and the tax breakdown appear on them."
                  : "No tax is charged on any bill and GST fields are hidden. Bills already issued keep the GST they were issued with."}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Pricing</CardTitle>
          <CardDescription>
            This changes every total in the system, so it is set once for the
            whole business.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Nothing to include when no tax is charged, so the switch is hidden
              rather than left on screen doing nothing. */}
          {gstOn ? (
            <div className="flex items-start gap-3">
              <Switch
                id="pricesIncludeTax"
                checked={includeTax}
                onCheckedChange={setIncludeTax}
                disabled={!canManage}
              />
              <div className="space-y-0.5">
                <Label htmlFor="pricesIncludeTax">Prices include tax</Label>
                <p className="text-xs text-muted-foreground">
                  {includeTax
                    ? "The price typed on a bill already contains tax; the tax component is derived from it."
                    : "Tax is added on top of the price typed on a bill."}
                </p>
              </div>
            </div>
          ) : null}

          <div className="mt-4 max-w-sm">
            <Field
              id="newStockSalesChannel"
              label="NEW stock is billed in"
              error={errors.newStockSalesChannel?.message}
              hint="Only affects NEW items. Everything else is always sold here."
            >
              <FormSelect
                control={control}
                name="newStockSalesChannel"
                id="newStockSalesChannel"
                label="NEW stock is billed in"
                disabled={!canManage}
                options={[
                  { value: "EXTERNAL", label: "The other billing system only" },
                  { value: "ECITY", label: "ECITY only" },
                  { value: "BOTH", label: "Both systems" },
                ]}
              />
            </Field>
          </div>

          <div className="mt-4 max-w-xs">
            <Field
              id="defaultCreditDays"
              label="Default credit period (days)"
              error={errors.defaultCreditDays?.message}
              hint="Prefills the due date when a bill leaves the counter unpaid"
            >
              <Input
                id="defaultCreditDays"
                inputMode="numeric"
                disabled={!canManage}
                {...register("defaultCreditDays")}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      {canManage ? (
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full sm:w-auto"
          >
            {isSubmitting ? "Saving…" : "Save profile"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

function TaxRates({
  rates,
  canManage,
}: {
  rates: TaxRate[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [percent, setPercent] = useState("");
  const [pending, startTransition] = useTransition();

  async function add() {
    const res = await apiFetch("/api/business/tax-rates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, ratePercent: percent, isDefault: false }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setName("");
    setPercent("");
    toast.success("Tax rate added.");
    startTransition(() => router.refresh());
  }

  async function setActive(rate: TaxRate, isActive: boolean) {
    const res = await apiFetch(`/api/business/tax-rates/${rate.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Tax rates</CardTitle>
        <CardDescription>
          Stored as exact integers, never decimals — a rate multiplies money.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="divide-y rounded-md border">
          {rates.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 p-3">
              <span className="min-w-0 flex-1 truncate font-medium">
                {r.name}
              </span>
              <span className="tabular font-mono text-sm">
                {toPercent(r.rateBasisPoints).toFixed(2)}%
              </span>
              {r.isDefault ? <Badge>Default</Badge> : null}
              {!r.isActive ? <Badge variant="muted">Inactive</Badge> : null}
              {canManage ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => void setActive(r, !r.isActive)}
                >
                  {r.isActive ? "Deactivate" : "Reactivate"}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>

        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Input
              className="min-w-0 flex-1 sm:max-w-xs"
              placeholder="Name, e.g. GST 18%"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Tax rate name"
            />
            <Input
              className="w-28"
              placeholder="18"
              inputMode="decimal"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              aria-label="Tax rate percent"
            />
            <Button
              onClick={() => void add()}
              disabled={!name || !percent || pending}
            >
              Add rate
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The kinds the database recognises, spelled for a person. */
const PAYMENT_TYPES = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "CARD", label: "Card" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "OTHER", label: "Other" },
] as const;

type MethodDraft = {
  code: string;
  name: string;
  type: string;
  affectsCashDrawer: boolean;
};

const emptyDraft = (): MethodDraft => ({
  code: "",
  name: "",
  type: "CASH",
  affectsCashDrawer: true,
});

/**
 * The shop's payment methods.
 *
 * Until now this screen could only activate and deactivate what was already
 * there — and payment methods are only ever created by the seed, so a business
 * set up by hand had none and no way to make one. That is not a cosmetic gap:
 * with no methods the till renders no payment buttons at all, and a cash sale
 * becomes impossible.
 *
 * Deactivating rather than deleting, for the usual reason (docs/02 §2.2 rule
 * 4): every sale, expense and supplier payment ever taken points at the method
 * it used. An inactive method keeps all of that and simply stops being offered.
 */
function PaymentMethods({
  methods,
  canManage,
}: {
  methods: PaymentMethod[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<MethodDraft>(emptyDraft());
  const [editing, setEditing] = useState<number | null>(null);
  const [edit, setEdit] = useState<MethodDraft>(emptyDraft());
  const [busy, setBusy] = useState(false);

  async function save(body: Record<string, unknown>, done: string) {
    setBusy(true);
    const res = await apiFetch("/api/business/payment-methods", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    toast.success(done);
    startTransition(() => router.refresh());
    return true;
  }

  async function add() {
    const ok = await save(
      {
        code: draft.code.trim().toUpperCase(),
        name: draft.name.trim(),
        type: draft.type,
        affectsCashDrawer: draft.affectsCashDrawer,
      },
      "Payment method added.",
    );
    if (ok) setDraft(emptyDraft());
  }

  async function saveEdit(m: PaymentMethod) {
    const ok = await save(
      {
        id: m.id,
        // The code is the method's identifier and is not editable; it is sent
        // back unchanged because the endpoint upserts on the whole shape.
        code: m.code,
        name: edit.name.trim(),
        type: edit.type,
        affectsCashDrawer: edit.affectsCashDrawer,
        sortOrder: m.sortOrder,
      },
      "Payment method updated.",
    );
    if (ok) setEditing(null);
  }

  async function setActive(m: PaymentMethod, isActive: boolean) {
    const res = await apiFetch(`/api/business/payment-methods/${m.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`${m.name} ${isActive ? "reactivated" : "deactivated"}.`);
    startTransition(() => router.refresh());
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Payment methods</CardTitle>
        <CardDescription>
          Cash methods post to the branch drawer; the rest post to accounts. A
          deactivated method stops being offered at the till, but every past
          payment keeps it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {methods.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            No payment methods yet. Until you add one, the till has nothing to
            take payment with — start with Cash.
          </p>
        ) : (
          <ul className="divide-y rounded-md border" data-testid="payment-methods">
            {methods.map((m) =>
              editing === m.id ? (
                <li key={m.id} className="space-y-3 p-3" data-testid="payment-method-edit">
                  <div className="flex flex-wrap items-end gap-2">
                    <Badge variant="outline" className="font-mono text-[11px]">
                      {m.code}
                    </Badge>
                    <Input
                      className="min-w-0 flex-1 sm:max-w-xs"
                      value={edit.name}
                      onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                      aria-label={`Name for ${m.name}`}
                    />
                    <AppSelect
                      label={`Type for ${m.name}`}
                      className="w-40"
                      value={edit.type}
                      onValueChange={(v) => setEdit({ ...edit, type: v })}
                      options={[...PAYMENT_TYPES]}
                    />
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Switch
                      checked={edit.affectsCashDrawer}
                      onCheckedChange={(c) => setEdit({ ...edit, affectsCashDrawer: c })}
                      aria-label={`Posts to the cash drawer for ${m.name}`}
                    />
                    Money taken this way goes into the branch cash drawer
                  </label>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy || !edit.name.trim()} onClick={() => void saveEdit(m)}>
                      {busy ? "Saving…" : "Save"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                </li>
              ) : (
                <li key={m.id} className="flex flex-wrap items-center gap-2 p-3" data-testid="payment-method-row">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {m.name}
                  </span>
                  <Badge variant="outline" className="font-mono text-[11px]">
                    {m.type}
                  </Badge>
                  {m.affectsCashDrawer ? (
                    <Badge variant="muted">Cash drawer</Badge>
                  ) : null}
                  {!m.isActive ? <Badge variant="muted">Inactive</Badge> : null}
                  {canManage ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        aria-label={`Edit ${m.name}`}
                        onClick={() => {
                          setEditing(m.id);
                          setEdit({
                            code: m.code,
                            name: m.name,
                            type: m.type,
                            affectsCashDrawer: m.affectsCashDrawer,
                          });
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        aria-label={`${m.isActive ? "Deactivate" : "Reactivate"} ${m.name}`}
                        onClick={() => void setActive(m, !m.isActive)}
                      >
                        {m.isActive ? "Deactivate" : "Reactivate"}
                      </Button>
                    </>
                  ) : null}
                </li>
              ),
            )}
          </ul>
        )}

        {canManage ? (
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm font-medium">Add a payment method</p>
            <div className="flex flex-wrap gap-2">
              <Input
                className="w-32 font-mono"
                placeholder="CASH"
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                aria-label="Payment method code"
              />
              <Input
                className="min-w-0 flex-1 sm:max-w-xs"
                placeholder="Cash"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                aria-label="Payment method name"
              />
              <AppSelect
                label="Payment method type"
                className="w-40"
                value={draft.type}
                onValueChange={(v) =>
                  // Cash is the one kind that reaches the till by default; the
                  // switch below still has the final say.
                  setDraft({ ...draft, type: v, affectsCashDrawer: v === "CASH" })
                }
                options={[...PAYMENT_TYPES]}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Switch
                checked={draft.affectsCashDrawer}
                onCheckedChange={(c) => setDraft({ ...draft, affectsCashDrawer: c })}
                aria-label="Posts to the cash drawer"
              />
              Money taken this way goes into the branch cash drawer
            </label>
            <Button
              onClick={() => void add()}
              disabled={busy || draft.code.trim().length < 2 || draft.name.trim().length < 2}
            >
              {busy ? "Adding…" : "Add method"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ExpenseCategories({
  categories,
  canManage,
}: {
  categories: ExpenseCategory[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  async function add() {
    const res = await apiFetch("/api/business/expense-categories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setName("");
    toast.success("Category added.");
    startTransition(() => router.refresh());
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Expense categories</CardTitle>
        <CardDescription>The headings expenses are filed under.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <Badge key={c.id} variant={c.isActive ? "secondary" : "muted"}>
              {c.name}
            </Badge>
          ))}
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Input
              className="min-w-0 flex-1 sm:max-w-xs"
              placeholder="New category"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Expense category name"
            />
            <Button onClick={() => void add()} disabled={!name || pending}>
              Add
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
