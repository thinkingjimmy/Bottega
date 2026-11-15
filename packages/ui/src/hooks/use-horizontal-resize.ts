/**
 * [INPUT]: React pointer events, controlled panel geometry and optional preview, finish and snap settings.
 * [OUTPUT]: Provides resolveHorizontalResize and useHorizontalResize with pointer capture, optional frame previews, dwell release and gesture cleanup.
 * [POS]: UI's horizontal-resize interaction kernel, shared by SidebarRail and desktop Chat's third (side) panel
 */

import * as React from "react"

export type HorizontalResizeLayout = { open: boolean; width: number }

export type HorizontalResizeGesture = {
  snapPoint: number | null
  snapDistance: number
  onPreview: (layout: HorizontalResizeLayout) => void
  onFinish: (layout: HorizontalResizeLayout | null) => void
}

type HorizontalResizeOptions = {
  enabled: boolean
  open: boolean
  setOpen: (open: boolean) => void
  width: number
  minWidth: number
  maxWidth: number
  direction?: 1 | -1
  onWidthChange?: (width: number) => void
  gesture?: HorizontalResizeGesture
}

type SnapState = {
  point: number
  hand: number
  anchor: number
  timer: number | undefined
  offset: number | null
}

type ResizePreview = {
  options: HorizontalResizeGesture
  layout: HorizontalResizeLayout
  frame: number | undefined
  snap: SnapState | null
}

type HorizontalDrag = {
  pointerId: number
  startX: number
  startWidth: number
  direction: 1 | -1
  moved: boolean
  target: HTMLButtonElement
  unlockBody: () => void
  preview: ResizePreview | null
}

type HorizontalResizeResult =
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

const SNAP_DWELL_MS = 300
const SNAP_STILL_DISTANCE = 1

function resolveSnap(
  hand: number,
  snap: SnapState,
  distance: number,
  minWidth: number,
  setSnapped: (snapped: boolean) => void,
) {
  if (snap.offset !== null) return hand + snap.offset
  snap.hand = hand
  if (hand < minWidth || Math.abs(hand - snap.point) > distance) {
    if (snap.timer !== undefined) {
      window.clearTimeout(snap.timer)
      snap.timer = undefined
      setSnapped(false)
    }
    return hand
  }

  if (snap.timer === undefined || Math.abs(hand - snap.anchor) > SNAP_STILL_DISTANCE) {
    window.clearTimeout(snap.timer)
    snap.anchor = hand
    setSnapped(true)
    snap.timer = window.setTimeout(() => {
      // Keep the edge under the same offset from the hand for the rest of this drag.
      snap.offset = snap.point - snap.hand
      snap.timer = undefined
      setSnapped(false)
    }, SNAP_DWELL_MS)
  }
  return snap.point
}

function lockBodyInteraction(style: CSSStyleDeclaration) {
  const { cursor, userSelect } = style
  style.cursor = "col-resize"
  style.userSelect = "none"
  return () => {
    style.cursor = cursor
    style.userSelect = userSelect
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
  gesture,
}: HorizontalResizeOptions) {
  const dragRef = React.useRef<HorizontalDrag | null>(null)
  const [active, setActive] = React.useState(false)
  const [previewWidth, setPreviewWidth] = React.useState<number | null>(null)
  const [snapped, setSnapped] = React.useState(false)
  const transactional = Boolean(gesture)

  const clearDrag = React.useCallback((drag: HorizontalDrag) => {
    dragRef.current = null
    const preview = drag.preview
    if (preview?.frame !== undefined) window.cancelAnimationFrame(preview.frame)
    window.clearTimeout(preview?.snap?.timer)
    drag.unlockBody()
    if (drag.target.hasPointerCapture(drag.pointerId)) {
      drag.target.releasePointerCapture(drag.pointerId)
    }
  }, [])

  const complete = React.useCallback((drag: HorizontalDrag, commit: boolean) => {
    clearDrag(drag)
    setActive(false)
    setPreviewWidth(null)
    setSnapped(false)
    drag.preview?.options.onFinish(commit && drag.moved ? drag.preview.layout : null)
  }, [clearDrag])

  React.useEffect(
    () => () => {
      const drag = dragRef.current
      if (!drag) return
      clearDrag(drag)
      drag.preview?.options.onFinish(null)
    },
    [clearDrag]
  )

  React.useEffect(() => {
    const cancel = () => {
      const drag = dragRef.current
      if (drag?.preview) complete(drag, false)
    }
    if (!transactional || !enabled) {
      cancel()
      return
    }
    window.addEventListener("blur", cancel)
    return () => window.removeEventListener("blur", cancel)
  }, [enabled, transactional, complete])

  const start = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!enabled || event.button !== 0 || dragRef.current) return
    const target = event.currentTarget
    const side =
      direction === undefined
        ? target.closest<HTMLElement>("[data-side]")?.dataset.side
        : undefined
    const point = gesture?.snapPoint
    const snap = typeof point === "number" && point >= minWidth && point <= maxWidth
      ? { point, hand: width, anchor: width, timer: undefined, offset: null }
      : null
    target.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: open ? width : 0,
      direction: direction ?? (side === "right" ? -1 : 1),
      moved: false,
      target,
      unlockBody: lockBodyInteraction(target.ownerDocument.body.style),
      preview: gesture ? { options: gesture, layout: { open, width }, frame: undefined, snap } : null,
    }
    setActive(true)
  }

  const updatePreview = (drag: HorizontalDrag, preview: ResizePreview, clientX: number) => {
    const delta = (clientX - drag.startX) * drag.direction
    if (!drag.moved && Math.abs(delta) < 3) return
    drag.moved = true
    const hand = Math.round(drag.startWidth + delta)
    const target = preview.snap
      ? resolveSnap(hand, preview.snap, preview.options.snapDistance, minWidth, setSnapped)
      : hand
    const next = target < minWidth
      ? { open: false, width: preview.layout.width }
      : { open: true, width: Math.min(target, maxWidth) }
    if (next.open === preview.layout.open && next.width === preview.layout.width) return
    preview.layout = next
    if (preview.frame !== undefined) return
    preview.frame = window.requestAnimationFrame(() => {
      preview.frame = undefined
      setPreviewWidth(preview.layout.width)
      preview.options.onPreview(preview.layout)
    })
  }

  const move = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!enabled || !drag || drag.pointerId !== event.pointerId) return
    if (drag.preview) {
      updatePreview(drag, drag.preview, event.clientX)
      if (drag.moved) event.preventDefault()
      return
    }
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

  const finish = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const commit = enabled && event.type === "pointerup" && !event.defaultPrevented
    if (commit && drag.preview) updatePreview(drag, drag.preview, event.clientX)
    complete(drag, commit)
  }

  return { active, previewWidth, snapped, start, move, finish }
}
