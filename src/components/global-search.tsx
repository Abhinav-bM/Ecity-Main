"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { MAIN_TYPE_LABEL } from "@/components/main-type-badge";
import type { MainType } from "@/server/db/schema";

type Hit = {
  kind: string;
  id: number;
  title: string;
  subtitle: string | null;
  href: string;
  mainType?: MainType;
  isNewCut?: boolean;
  status?: string;
};

type Results = {
  query: string;
  direct: Hit | null;
  groups: { kind: string; label: string; hits: Hit[] }[];
  total: number;
};

/**
 * Global search (PRD FR-30.1).
 *
 * One box, reachable from every screen with ⌘K or /. The server decides what
 * the typed text means — a full IMEI, a phone number, an invoice — so the
 * palette only has to render what comes back and get out of the way.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Only the newest response may paint; a slow early query must not overwrite
  // a fast later one.
  const latest = useRef(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if (
        (e.key === "k" && (e.metaKey || e.ctrlKey)) ||
        (e.key === "/" && !typing)
      ) {
        e.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery("");
      setResults(null);
      router.push(href);
    },
    [router],
  );

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }

    const ticket = ++latest.current;
    setLoading(true);
    const timer = setTimeout(() => {
      void fetch(`/api/search?q=${encodeURIComponent(term)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: Results | null) => {
          if (ticket !== latest.current) return;
          setLoading(false);
          if (!data) return setResults(null);

          /*
           * FR-30.5. A complete IMEI is unambiguous, so open the device rather
           * than showing a list of one for someone to click.
           */
          if (data.direct) {
            go(data.direct.href);
            return;
          }
          setResults(data);
        })
        .catch(() => {
          if (ticket === latest.current) setLoading(false);
        });
    }, 180);

    return () => clearTimeout(timer);
  }, [query, go]);

  return (
    <>
      {/* Desktop: a real box, because search is the flagship. Phone: an icon. */}
      <Button
        variant="outline"
        size="sm"
        aria-label="Find anything"
        className="hidden h-8 w-56 justify-start gap-2 px-2 text-muted-foreground lg:flex"
        onClick={() => setOpen(true)}
      >
        <Search className="size-4" />
        <span className="text-xs">Find anything</span>
        <kbd className="ml-auto rounded border px-1 text-[10px]">⌘K</kbd>
      </Button>
      {/*
        "Find", not "Search": every list in the application has its own Search
        button that filters that list, and this does something different - it
        finds anything, anywhere. Sharing the word made the two indistinguishable
        to a screen reader as much as to a test.
      */}
      <Button
        variant="ghost"
        size="icon"
        aria-label="Find anything"
        className="lg:hidden"
        onClick={() => setOpen(true)}
      >
        <Search className="size-5" />
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search"
        description="IMEI, customer, product, invoice — anything."
      >
        {/*
          shouldFilter off: the server has already filtered. Re-filtering here
          would hide rows that matched on a field the title does not show —
          a phone number, an email, the second IMEI of a dual-SIM handset.
        */}
        <Command shouldFilter={false}>
          <div className="border-b p-2">
            <Input
              ref={inputRef}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="IMEI, phone number, customer, product, invoice…"
              aria-label="Find anything"
              className="border-0 shadow-none focus-visible:ring-0"
            />
          </div>
          <CommandList data-testid="search-results">
            {query.trim().length < 2 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                Type at least two characters. A full IMEI opens its device
                straight away.
              </p>
            ) : loading && !results ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                Searching…
              </p>
            ) : !results || results.total === 0 ? (
              <CommandEmpty>Nothing matched “{query.trim()}”.</CommandEmpty>
            ) : (
              results.groups.map((g) => (
                <CommandGroup key={g.kind} heading={g.label}>
                  {g.hits.map((h) => (
                    <CommandItem
                      key={`${h.kind}-${h.id}`}
                      value={`${h.kind}-${h.id}`}
                      onSelect={() => go(h.href)}
                      data-testid="search-hit"
                      className="gap-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{h.title}</span>
                        {h.subtitle ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {h.subtitle}
                          </span>
                        ) : null}
                      </span>
                      {h.mainType ? (
                        <Badge variant="secondary" className="shrink-0">
                          {MAIN_TYPE_LABEL[h.mainType]}
                          {h.isNewCut ? " · NEW CUT" : ""}
                        </Badge>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
