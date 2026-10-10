"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CaretDown, Info, Signature, Trophy, Wallet } from "@phosphor-icons/react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { DrawerFilm } from "@/components/welcome/welcome-films";
import { useCopy } from "@/components/settings-provider";
import { FEE_PCT_LABEL as FEE_PCT } from "@/lib/sodax-config";
import { SPRING_SHELF } from "@/lib/motion";
import { cn } from "@/lib/utils";

const FINE_PRINT_ID = "info-fine-print";

/**
 * Header (i) and its drawer, How Berth works: the hero film, three one line
 * points in Berth's voice, and the fine print, closed by default and never
 * remembered open, holding the disclosures (what a stock token is, the fee,
 * when orders fill, who holds what) and the links to the terms and privacy.
 */
export function InfoDrawer() {
  const [open, setOpen] = useState(false);
  const [finePrint, setFinePrint] = useState(false);
  const copy = useCopy();
  const scrollRef = useRef<HTMLDivElement>(null);
  /** True from a tap that opens the fine print until one that closes it. */
  const openingRef = useRef(false);
  const followFinePrint = () => {
    const area = scrollRef.current;
    if (area && openingRef.current) area.scrollTop = area.scrollHeight;
  };

  const points = [
    { icon: Signature, text: copy.infoPoints.buy },
    { icon: Trophy, text: copy.infoPoints.ranks },
    { icon: Wallet, text: copy.infoPoints.wallet },
  ];
  const fine = [copy.infoFineOwn, copy.infoFees(FEE_PCT), copy.infoFineFills, copy.infoFineCustody];

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={copy.infoOpenLabel}
        className="shrink-0"
        onClick={() => setOpen(true)}
      >
        <Info className="size-5" />
      </Button>

      <Drawer
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            openingRef.current = false;
            setFinePrint(false);
          }
        }}
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{copy.infoTitle}</DrawerTitle>
            <DrawerDescription>{copy.infoSub}</DrawerDescription>
          </DrawerHeader>

          <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <DrawerFilm />

            <ul className="flex flex-col gap-3">
              {points.map(({ icon: PointIcon, text }) => (
                <li key={text} className="flex items-start gap-3">
                  <PointIcon weight="duotone" aria-hidden className="mt-px size-5 shrink-0 text-foreground" />
                  <span className="text-[14.5px] leading-snug text-foreground">{text}</span>
                </li>
              ))}
            </ul>

            <section className="flex flex-col gap-2">
              <button
                type="button"
                aria-expanded={finePrint}
                aria-controls={FINE_PRINT_ID}
                onClick={() => {
                  openingRef.current = !finePrint;
                  setFinePrint(!finePrint);
                }}
                className="flex items-center gap-1.5 self-start text-[11.5px] font-bold tracking-(--tracking-caps) uppercase text-muted-foreground transition-colors hover:text-foreground"
              >
                {copy.infoFinePrintTitle}
                <CaretDown
                  weight="duotone"
                  aria-hidden
                  className={cn("size-3.5 transition-transform duration-200 ease-lift", finePrint && "rotate-180")}
                />
              </button>

              <AnimatePresence initial={false}>
                {finePrint && (
                  <motion.div
                    id={FINE_PRINT_ID}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={SPRING_SHELF}
                    // The toggle sits at the drawer's lower edge on a phone,
                    // so while the text opens the body follows it down, and
                    // the words slide up into view rather than open below.
                    // (A smooth scrollTo after the spring is cancelled in
                    // WebKit; following frame by frame is not.)
                    onUpdate={followFinePrint}
                    onAnimationComplete={followFinePrint}
                    className="overflow-hidden"
                  >
                    <div className="flex flex-col gap-2 text-[13px] leading-snug text-muted-foreground">
                      {fine.map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                      <div className="flex gap-5 pt-1">
                        <a href="/terms" className="underline underline-offset-4 hover:text-foreground">
                          {copy.termsLink}
                        </a>
                        <a href="/privacy" className="underline underline-offset-4 hover:text-foreground">
                          {copy.privacyLink}
                        </a>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
