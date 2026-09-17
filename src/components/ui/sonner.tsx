"use client"

import { useEffect } from "react"
import { toast, Toaster as Sonner, type ToasterProps } from "sonner"
import { useTheme } from "next-themes"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"

const Toaster = ({ ...props }: ToasterProps) => {
  // Follows the appearance: the description colour is pinned to the app's
  // tokens below, so only sonner's own contrast rules need to know.
  const { resolvedTheme } = useTheme()
  // Dev-only: headless smoke tests fire toasts via window.toast (no toast
  // is reachable pre-auth). Compiled out of production builds.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { toast: typeof toast }).toast = toast
    }
  }, [])

  return (
    <Sonner
      theme={resolvedTheme === "dark" ? "dark" : "light"}
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
          <Spinner className="size-4" />
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
