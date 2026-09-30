"use client";

import { createContext, useContext, type ReactNode } from "react";
import { AVAILABLE, type Availability } from "@/lib/availability";

/**
 * The soft landing, client side (lib/availability). The server decides,
 * once per page render, from the request's country (lib/server/availability)
 * and hands the answer down through this context; absent, everything is
 * available, and the server still refuses what it must on its own routes.
 */
const AvailabilityContext = createContext<Availability>(AVAILABLE);

export function AvailabilityProvider({ value, children }: { value: Availability; children: ReactNode }) {
  return <AvailabilityContext.Provider value={value}>{children}</AvailabilityContext.Provider>;
}

export function useAvailability(): Availability {
  return useContext(AvailabilityContext);
}

