import { cn } from "@/lib/utils"

/**
 * The house loader: three steam dots rising in turn, in currentColor.
 * Same slot and sizing contract as the old arc spinner, so call sites
 * only ever say <Spinner className="size-4" />.
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={cn("size-4", className)}
      {...props}
    >
      {[3, 8, 13].map((x, i) => (
        <circle
          key={x}
          cx={x}
          cy="12"
          r="1.8"
          style={{
            animation: `steam-dot-rise 1.2s var(--ease-tea, ease-in-out) ${i * 0.4}s infinite`,
          }}
        />
      ))}
    </svg>
  )
}

export { Spinner }
