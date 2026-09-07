"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppSelect } from "@/components/app-select";

const STATUSES = [
  { value: "REQUESTED", label: "Requested — waiting for approval" },
  { value: "APPROVED", label: "Approved — ready to send" },
  { value: "IN_TRANSIT", label: "In transit" },
  { value: "RECEIVED", label: "Received" },
  { value: "CANCELLED", label: "Cancelled" },
];

/** Filtering by REQUESTED is the approval queue; by IN_TRANSIT, the receiving one. */
export function StatusFilter({
  status,
  search,
}: {
  status: string;
  search: string;
}) {
  const router = useRouter();

  function go(next: Record<string, string>) {
    const q = new URLSearchParams();
    const merged = { status, search, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    router.push(q.toString() ? `/transfers?${q.toString()}` : "/transfers");
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-3">
        {/*
          The spec calls these the approval queue and the receiving screen.
          They are the same list filtered, so they are one-click entries rather
          than two more pages that could drift apart from this one.
        */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant={status === "REQUESTED" ? "default" : "outline"}
            size="sm"
            asChild
          >
            <Link href="/transfers?status=REQUESTED">Waiting for approval</Link>
          </Button>
          <Button
            variant={status === "IN_TRANSIT" ? "default" : "outline"}
            size="sm"
            asChild
          >
            <Link href="/transfers?status=IN_TRANSIT">To receive</Link>
          </Button>
          {status ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/transfers">Show everything</Link>
            </Button>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="transfer-status">Stage</Label>
            <AppSelect
              id="transfer-status"
              label="Stage"
              allowEmpty
              emptyLabel="Every stage"
              placeholder="Every stage"
              value={status}
              onValueChange={(v) => go({ status: v })}
              options={STATUSES}
            />
          </div>
          <form
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const value = new FormData(e.currentTarget).get("search");
              go({ search: typeof value === "string" ? value : "" });
            }}
          >
            <Label htmlFor="transfer-search">Transfer number</Label>
            <Input id="transfer-search" name="search" defaultValue={search} />
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
