"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { ThemeProvider, useTheme } from "next-themes";

import { useTokenPrices } from "@/hooks/use-token-prices";
import { COPY, type Copy } from "@/lib/copy";
import {
  DEFAULT_APPEARANCE,
  isAppearanceId,
  type AppearanceId,
} from "@/lib/appearance";
import {
  DEFAULT_CURRENCY,
  fxDayLabel,
  fxRateStale,
  isCurrency,
  resolveMoney,
  type Currency,
} from "@/lib/currencies";
import {
  currencyFractionDigits,
  currencySymbol,
  formatMoney,
  formatMoneyPrecise,
  splitAccruingMoney,
} from "@/lib/format";

const CURRENCY_STORAGE_KEY = "berth.currency";
/** Read once, on first load, so a prior visitor's choice isn't dropped. */
const LEGACY_CURRENCY_STORAGE_KEY = "lsteatime.currency";

type CurrencyContextValue = {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
};

const CurrencyContext = createContext<CurrencyContextValue>({
  currency: DEFAULT_CURRENCY,
  setCurrency: () => {},
});

/* localStorage IS the currency store; React just subscribes to it. The
   server snapshot is the default, so SSR renders USD and the stored choice
   arrives with hydration. */
const currencyListeners = new Set<() => void>();

function subscribeCurrency(listener: () => void): () => void {
  currencyListeners.add(listener);
  return () => {
    currencyListeners.delete(listener);
  };
}

/** Session-only fallback so the picker still works when storage is blocked. */
let memoryCurrency: Currency | null = null;

function readStoredCurrency(): Currency {
  try {
    const stored = window.localStorage.getItem(CURRENCY_STORAGE_KEY);
    if (isCurrency(stored)) return stored;
    // Nothing under the new key yet: fall back to what a visitor chose
    // before the rebrand, then carry it forward under the new key.
    const legacy = window.localStorage.getItem(LEGACY_CURRENCY_STORAGE_KEY);
    if (isCurrency(legacy)) {
      window.localStorage.setItem(CURRENCY_STORAGE_KEY, legacy);
      return legacy;
    }
  } catch {
    // Fall through to the in-memory choice.
  }
  return memoryCurrency ?? DEFAULT_CURRENCY;
}

/**
 * Appearance + currency. Appearance rides next-themes: system, light, or
 * dark, persisted per browser with a pre-hydration script so the page never
 * flashes the wrong one.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const currency = useSyncExternalStore(
    subscribeCurrency,
    readStoredCurrency,
    () => DEFAULT_CURRENCY,
  );

  const setCurrency = useCallback((next: Currency) => {
    memoryCurrency = next;
    try {
      window.localStorage.setItem(CURRENCY_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the in-memory copy carries this session.
    }
    for (const listener of currencyListeners) listener();
  }, []);

  const currencyValue = useMemo(
    () => ({ currency, setCurrency }),
    [currency, setCurrency],
  );

  return (
    <ThemeProvider
      attribute="class"
      themes={["light", "dark"]}
      enableSystem
      defaultTheme="system"
      storageKey="berth.appearance"
      disableTransitionOnChange
    >
      <CurrencyContext.Provider value={currencyValue}>
        {children}
      </CurrencyContext.Provider>
    </ThemeProvider>
  );
}

/** The active appearance. "system" during SSR and the first client frame. */
export function useAppearance(): {
  appearance: AppearanceId;
  setAppearance: (id: AppearanceId) => void;
} {
  const { theme, setTheme } = useTheme();
  return {
    appearance: isAppearanceId(theme) ? theme : DEFAULT_APPEARANCE,
    // Where the View Transitions API exists (Safari 18+, Chrome), wash the
    // repaint in its default crossfade; reduced motion keeps the cut.
    setAppearance: (id: AppearanceId) => {
      if (
        typeof document !== "undefined" &&
        "startViewTransition" in document &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        // flushSync so the class swap lands inside the transition's capture
        // window; next-themes updates via React state otherwise too late.
        document.startViewTransition(() => flushSync(() => setTheme(id)));
      } else {
        setTheme(id);
      }
    },
  };
}

/** The app's one voice. Components read lines, never literals. */
export function useCopy(): Copy {
  return COPY;
}

export function useCurrency(): CurrencyContextValue {
  return useContext(CurrencyContext);
}

/**
 * Everything a component needs to print money in the user's currency.
 * All inputs stay USD; the hook owns the one multiplication. Rates ride the
 * shared `useTokenPrices` fetch, and `resolveMoney` speaks USD until the FX
 * rate for the chosen currency has actually arrived.
 */
export function useMoney() {
  const { currency } = useCurrency();
  const prices = useTokenPrices().data;
  const fx = prices?.fx;
  const fxDate = prices?.fxDate;

  return useMemo(() => {
    const money = resolveMoney(currency, fx);
    const converted = money.currency !== "USD";
    // The ECB day behind the rate, named only once it is more than a day
    // old (a weekend, a holiday): a fresh rate is simply today's.
    const staleDay =
      converted && fxDate && fxRateStale(fxDate) ? fxDayLabel(fxDate) : undefined;
    const format = (usd: number) => formatMoney(usd, money);
    return {
      /** The currency actually being printed (USD while rates settle). */
      currency: money.currency,
      /**
       * USD → display multiplier, for the one place that must convert the
       * OTHER way: amount entry, where the typed number is already in the
       * display currency and the math needs USD.
       */
      rate: money.rate,
      /** The bare sign for the amount field's prefix ("$", "€", "¥"). */
      symbol: currencySymbol(money.currency),
      /** Conventional fraction digits (2 for EUR, 0 for JPY). */
      fractionDigits: currencyFractionDigits(money.currency),
      /** True when figures are converted from USD at an ECB rate. */
      converted,
      /** "Oct 3" when the rate in use is more than a day old, else undefined. */
      staleDay,
      format,
      /**
       * The quiet line under a figure that stays in dollars (a limit price):
       * "about €184.00 at today's rate". Null while printing USD.
       */
      aboutAtRate: (usd: number): string | null =>
        !converted
          ? null
          : staleDay
            ? COPY.moneyAboutAtRateOf(format(usd), staleDay)
            : COPY.moneyAboutAtTodaysRate(format(usd)),
      formatPrecise: (usd: number) => formatMoneyPrecise(usd, money),
      split: (usd: number) => splitAccruingMoney(usd, money),
    };
  }, [currency, fx, fxDate]);
}
