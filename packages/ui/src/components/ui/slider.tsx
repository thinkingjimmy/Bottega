import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "@ai-chat/ui/lib/utils"

function Slider({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-3 w-full grow overflow-hidden rounded-full bg-muted"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute h-full bg-primary"
        />
      </SliderPrimitive.Track>
      {Array.from({ length: props.value?.length ?? props.defaultValue?.length ?? 1 }).map(
        (_, index) => (
          <SliderPrimitive.Thumb
            key={index}
            data-slot="slider-thumb"
            className="relative z-20 block size-6 rounded-full border bg-background shadow-md outline-none transition-[box-shadow,transform] focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-105 disabled:pointer-events-none"
          />
        )
      )}
    </SliderPrimitive.Root>
  )
}

export { Slider }
