'use client'

import {
  Toast,
  ToastDescription,
  ToastRegion,
  ToastTitle,
  toast,
  type ToastRegionProps,
} from '@ui-sdk/react/toast'
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react'

const icons = {
  success: <CircleCheckIcon className="size-4 shrink-0" aria-hidden="true" />,
  info: <InfoIcon className="size-4 shrink-0" aria-hidden="true" />,
  warning: <TriangleAlertIcon className="size-4 shrink-0" aria-hidden="true" />,
  error: <OctagonXIcon className="size-4 shrink-0" aria-hidden="true" />,
  loading: <Loader2Icon className="size-4 shrink-0 animate-spin" aria-hidden="true" />,
} as const

// Pill toasts with inverted colors (ground = text color); errors in red.
// Stacking and animation come with the item's CSS (data-slot toast-region).
function Toaster(props: Omit<ToastRegionProps, 'children'>) {
  return (
    <ToastRegion side="top" align="center" {...props}>
      {(item) => (
        <Toast className="flex items-center gap-2 rounded-full border border-foreground bg-foreground px-4 py-3 text-sm font-medium text-background shadow-lg data-[type=error]:border-destructive data-[type=error]:bg-destructive data-[type=error]:text-destructive-foreground">
          {item.type && item.type in icons ? icons[item.type as keyof typeof icons] : null}
          <div className="flex min-w-0 flex-col">
            <ToastTitle />
            <ToastDescription className="text-xs opacity-80 empty:hidden" />
          </div>
        </Toast>
      )}
    </ToastRegion>
  )
}

export { Toaster, toast }
