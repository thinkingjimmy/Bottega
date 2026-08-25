/**
 * [INPUT]: Depends on React PointerEvent/State, receiving the control panel's horizontal opening, width, direction and boundary
 * [OUTPUT]: Provides resolve HorizontalResize/useHorizontalResize, unified Pointer Capture, threshold capture and full path clearance
 * [POS]: The UI's horizontal scaling interaction kernel is shared by SidebarRail and desktop Chat Third-Pain
 */

import * as React from "react"

type HorizontalResizeOptions = {
  enabled: boolean
  open: boolean
  setOpen: (open: boolean) => void
  width: number
  minWidth: number
  maxWidth: number
  direction?: 1 | -1
  onWidthChange?: (width: number) => void
}

type HorizontalDrag = {
  pointerId: number
  startX: number
  startWidth: number
  direction: 1 | -1
  moved: boolean
  target: HTMLButtonElement
}

export type HorizontalResizeResult =
  | { kind: "underflow" }
  | { kind: "resize"; width: number }

export function resolveHorizontalResize({
  startWidth,
  deltaX,
  direction,
  minWidth,
  maxWidth,
}: {
  startWidth: number
  deltaX: number
  direction: 1 | -1
  minWidth: number
  maxWidth: number
}): HorizontalResizeResult {
  const nextWidth = Math.round(startWidth + deltaX * direction)
  if (nextWidth < minWidth) return { kind: "underflow" }
  return { kind: "resize", width: Math.min(nextWidth, maxWidth) }
}

function lockBodyInteraction() {
  const { cursor, userSelect } = document.body.style
  document.body.style.cursor = "col-resize"
  document.body.style.userSelect = "none"
  return () => {
    document.body.style.cursor = cursor
    document.body.style.userSelect = userSelect
  }
}

export function useHorizontalResize({
  enabled,
  open,
  setOpen,
  width,
  minWidth,
  maxWidth,
  direction,
  onWidthChange,
}: HorizontalResizeOptions) {
  const dragRef = React.useRef<HorizontalDrag | null>(null)
  const unlockBodyRef = React.useRef<(() => void) | null>(null)
  const [active, setActive] = React.useState(false)

  const unlockBody = React.useCallback(() => {
    unlockBodyRef.current?.()
    unlockBodyRef.current = null
  }, [])

  const finish = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    dragRef.current = null
    unlockBody()
    setActive(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  React.useEffect(
    () => () => {
      const drag = dragRef.current
      if (drag?.target.hasPointerCapture(drag.pointerId)) {
        drag.target.releasePointerCapture(drag.pointerId)
      }
      unlockBody()
    },
    [unlockBody]
  )

  const start = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!enabled || event.button !== 0 || dragRef.current) return
    const side =
      direction === undefined
        ? event.currentTarget.closest<HTMLElement>("[data-side]")?.dataset.side
        : undefined
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: open ? width : 0,
      direction: direction ?? (side === "right" ? -1 : 1),
      moved: false,
      target: event.currentTarget,
    }
    unlockBodyRef.current = lockBodyInteraction()
    event.currentTarget.setPointerCapture(event.pointerId)
    setActive(true)
  }

  const move = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!enabled || !drag || drag.pointerId !== event.pointerId) return
    const delta = (event.clientX - drag.startX) * drag.direction
    if (!drag.moved && Math.abs(delta) < 3) return

    drag.moved = true
    const result = resolveHorizontalResize({
      startWidth: drag.startWidth,
      deltaX: event.clientX - drag.startX,
      direction: drag.direction,
      minWidth,
      maxWidth,
    })
    if (result.kind === "underflow") {
      setOpen(false)
    } else {
      setOpen(true)
      onWidthChange?.(result.width)
    }
    event.preventDefault()
  }

  return { active, start, move, finish }
}
