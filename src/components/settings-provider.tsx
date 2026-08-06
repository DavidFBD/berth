"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { useQuery } from "@tanstack/react-query";

import {
  COPY,
  DEFAULT_MODE,
  MODES,
  isModeId,
  type Copy,
  type ModeId,
} from "@/lib/copy";
import {
  DEFAULT_CURRENCY,
  isCurrency,
  type Currency,
  type FxRates,
} from "@/lib/currencies";
import {
  formatMoney,
  formatMoneyPrecise,
  splitAccruingMoney,
  type Money,
} from "@/lib/format";

const CURRENCY_STORAGE_KEY = "lsteatime.currency";

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
  } catch {
    // Fall through to the in-memory choice.
  }
  return memoryCurrency ?? DEFAULT_CURRENCY;
}

/**
 * Modes + currency. Modes ride next-themes — not for light/dark (the app
 * deliberately has neither), but because it already solves the hard parts of
 * a class-switched theme: localStorage persistence and a pre-hydration
 * script so the page never flashes the wrong skin.
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
      themes={MODES.map((mode) => mode.id)}
      value={Object.fromEntries(MODES.map((m) => [m.id, m.className]))}
      defaultTheme={DEFAULT_MODE}
      enableSystem={false}
      storageKey="lsteatime.mode"
      disableTransitionOnChange
    >
      <CurrencyContext.Provider value={currencyValue}>
        {children}
      </CurrencyContext.Provider>
    </ThemeProvider>
  );
}

/** The active mode. Original during SSR and the first client frame. */
export function useMode(): { mode: ModeId; setMode: (mode: ModeId) => void } {
  const { theme, setTheme } = useTheme();
  return {
    mode: isModeId(theme) ? theme : DEFAULT_MODE,
    setMode: setTheme,
  };
}

/** The active mode's voice. Components read lines, never literals. */
export function useCopy(): Copy {
  return COPY[useMode().mode];
}

export function useCurrency(): CurrencyContextValue {
  return useContext(CurrencyContext);
}

type FxPayload = { fx?: FxRates };

/** Refetch a little ahead of the route's 5-minute server cache. */
const FX_REFETCH_MS = 4 * 60 * 1000;

/**
 * Everything a component needs to print money in the user's currency.
 * All inputs stay USD; the hook owns the one multiplication. When the FX
 * rate hasn't arrived (or the fetch degraded), it speaks USD rather than
 * guessing — a wrong currency symbol on a right number is worse than a
 * moment of dollars.
 */
export function useMoney() {
  const { currency } = useCurrency();
  const { data: fx } = useQuery({
    queryKey: ["tokenPrices", "fx"],
    queryFn: async (): Promise<FxRates> => {
      const response = await fetch("/api/token-prices");
      if (!response.ok) return {};
      const payload = (await response.json()) as FxPayload;
      return payload.fx ?? {};
    },
    staleTime: FX_REFETCH_MS,
    refetchInterval: FX_REFETCH_MS,
  });

  return useMemo(() => {
    const rate = fx?.[currency];
    const money: Money =
      rate !== undefined && rate > 0
        ? { currency, rate }
        : { currency: "USD", rate: 1 };
    return {
      /** The currency actually being printed (USD while rates settle). */
      currency: money.currency,
      format: (usd: number) => formatMoney(usd, money),
      formatPrecise: (usd: number) => formatMoneyPrecise(usd, money),
      split: (usd: number) => splitAccruingMoney(usd, money),
    };
  }, [currency, fx]);
}
