"use client"

import { useEffect } from "react"
import { toast, Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  // Dev-only: headless smoke tests fire toasts via window.toast (no toast
  // is reachable pre-auth). Compiled out of production builds.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { toast: typeof toast }).toast = toast
    }
  }, [])

  return (
    <Sonner
      // Always the morning palette: the app never applies `.dark` (the
      // evening theme is dormant), so following the OS scheme here painted
      // sonner's dark-theme description gray onto the cream --popover
      // background — unreadable. Revisit if the evening theme ever ships.
      theme="light"
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
          // Sonner only themes the title via --normal-text; pin the
          // description to the app palette so it stays readable.
          description: "!text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
