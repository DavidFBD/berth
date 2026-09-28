"use client";

import { useCopy } from "@/components/settings-provider";

/** A money row's name with its figure set in the number face: "Cash, $2.00". */
export function MoneyName({ name, amount }: { name: string; amount: string }) {
  const copy = useCopy();
  const [before, after = ""] = copy.moneyRowName(name, "\u0000").split("\u0000");
  return (
    <>
      {before}
      <span className="money tabular-nums">{amount}</span>
      {after}
    </>
  );
}
