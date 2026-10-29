"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { CompanyMark } from "@/components/company-marks";
import { useCopy } from "@/components/settings-provider";
import { STOCK_LISTINGS, LISTING_MARK_BY_SYMBOL, type TokenListing } from "@/lib/listings";
import { stageBusy } from "@/lib/level-up";
import { isApplePlatform, moveIndex, searchListings, shortcutAction, shortcutLabel } from "@/lib/command-menu";

const subscribe = () => () => {};
const readApple = () => isApplePlatform(typeof navigator === "undefined" ? undefined : navigator.platform);

/** Whether this is a Mac (Command) rather than Control; false on the server. */
function useIsApple(): boolean {
  return useSyncExternalStore(subscribe, readApple, () => false);
}

/**
 * The quiet shortcut chip beside the header: shown only where there is a
 * fine pointer and a hover (a desktop or laptop), never on a touch phone.
 */
export function CommandHint({ onOpen }: { onOpen: () => void }) {
  const copy = useCopy();
  const apple = useIsApple();
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={copy.commandMenu.openHint}
      className="hidden items-center gap-1 rounded-full border border-border px-2 py-1 text-[11px] leading-none text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)_and_(pointer:fine)]:inline-flex"
    >
      <kbd className="money font-mono">{shortcutLabel(apple)}</kbd>
    </button>
  );
}

type Row =
  | { kind: "stock"; id: string; listing: TokenListing }
  | { kind: "page"; id: string; label: string; run: () => void };

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="money rounded border border-border px-1 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">{children}</kbd>;
}

/**
 * Command K: a small search over the listings, and a few places to go. Enter
 * on a listing opens its buy drawer through the home's own openBuy, the same
 * path a tap on the board takes.
 */
export function CommandMenu({
  open,
  onOpenChange,
  onBuy,
  onOpenBoard,
  onOpenAccount,
  onOpenFriends,
  onOpenAsk,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBuy: (listing: TokenListing) => void;
  onOpenBoard: () => void;
  onOpenAccount: () => void;
  onOpenFriends: () => void;
  /** Absent where the assistant is not offered. */
  onOpenAsk?: () => void;
}) {
  const copy = useCopy();
  const text = copy.commandMenu;
  const apple = useIsApple();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-opt-${index}`;

  // One listener for the key, here, so the home only owns the open flag.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = shortcutAction({
        event,
        apple,
        open: openRef.current,
        target: document.activeElement,
        busy: stageBusy(document),
      });
      if (action === "ignore") return;
      event.preventDefault();
      onOpenChange(action === "open");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [apple, onOpenChange]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const stocks = searchListings(STOCK_LISTINGS, query, q ? 8 : 5).map<Row>((listing) => ({
      kind: "stock",
      id: listing.symbol,
      listing,
    }));
    const pages: Row[] = [
      { kind: "page", id: "board", label: text.pageBoard, run: onOpenBoard },
      { kind: "page", id: "account", label: text.pageAccount, run: onOpenAccount },
      { kind: "page", id: "friends", label: text.pageFriends, run: onOpenFriends },
      ...(onOpenAsk ? [{ kind: "page", id: "ask", label: text.pageAsk, run: onOpenAsk } as Row] : []),
    ];
    const shown = q ? pages.filter((row) => row.kind === "page" && row.label.toLowerCase().includes(q)) : pages;
    return [...stocks, ...shown];
  }, [query, text, onOpenBoard, onOpenAccount, onOpenFriends, onOpenAsk]);

  const choose = useCallback(
    (row: Row | undefined) => {
      if (!row) return;
      onOpenChange(false);
      if (row.kind === "stock") onBuy(row.listing);
      else row.run();
    },
    [onOpenChange, onBuy],
  );

  const stockCount = rows.filter((row) => row.kind === "stock").length;
  const activeIndex = rows.length === 0 ? -1 : Math.min(active, rows.length - 1);

  const onInputKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(moveIndex(activeIndex, event.key === "ArrowDown" ? 1 : -1, rows.length));
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      choose(rows[activeIndex]);
    }
  };

  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setQuery("");
          setActive(0);
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Popup
          initialFocus={inputRef}
          aria-label={text.title}
          className="fixed top-[14vh] left-1/2 z-50 flex max-h-[70vh] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground outline-none"
        >
          <Dialog.Title className="sr-only">{text.title}</Dialog.Title>
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            aria-autocomplete="list"
            aria-label={text.placeholder}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            placeholder={text.placeholder}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKey}
            className="w-full border-b border-border bg-transparent px-4 py-3 text-base outline-none placeholder:text-muted-foreground"
          />
          <ul id={listId} role="listbox" aria-label={text.stocksHeading} className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {rows.length === 0 && <li role="presentation" className="px-3 py-6 text-center text-sm text-muted-foreground">{text.empty}</li>}
            {rows.map((row, index) => {
              const mark = row.kind === "stock" ? LISTING_MARK_BY_SYMBOL[row.listing.symbol] : undefined;
              return (
                <li key={`${row.kind}-${row.id}`} role="presentation">
                  {index === 0 && stockCount > 0 && <p aria-hidden className="px-3 pt-1.5 pb-1 text-[11px] text-muted-foreground">{text.stocksHeading}</p>}
                  {index === stockCount && row.kind === "page" && <p aria-hidden className="px-3 pt-2.5 pb-1 text-[11px] text-muted-foreground">{text.pagesHeading}</p>}
                  <div
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseMove={() => index !== activeIndex && setActive(index)}
                    onClick={() => choose(row)}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm aria-selected:bg-muted"
                  >
                    {row.kind === "stock" ? (
                      <>
                        <span aria-hidden className="money flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[8.5px] font-medium text-secondary-foreground">
                          {mark ? <CompanyMark id={mark} className="size-3.5" /> : row.listing.symbol.slice(0, 4)}
                        </span>
                        <span className="min-w-0 truncate">{row.listing.name}</span>
                        <span className="money ml-auto shrink-0 text-xs text-muted-foreground">{row.listing.symbol}</span>
                      </>
                    ) : (
                      <span className="truncate">{row.label}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div aria-hidden className="flex items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><Kbd>{"↑↓"}</Kbd>{text.hintMove}</span>
            <span className="flex items-center gap-1.5"><Kbd>Enter</Kbd>{text.hintOpen}</span>
            <span className="flex items-center gap-1.5"><Kbd>Esc</Kbd>{text.hintClose}</span>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
