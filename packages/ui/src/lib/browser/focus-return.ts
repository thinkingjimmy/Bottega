/**
 * [INPUT]: Depends on the DOM's document.activeElement only.
 * [OUTPUT]: Provides focusIsLost and returnFocusOnlyWhenLost, the close-focus rule of the animated overlays: a closing layer hands focus back to its trigger only when focus is lost.
 * [POS]: packages/ui/src/lib/browser; lib's focus rule, applied by components/ui's DropdownMenuContent and PopoverContent; a consumer that focuses something itself on close checks focusIsLost first.
 */

/** True when nothing holds focus: it rests on body, as it does once the content that held it is gone. */
export function focusIsLost() {
  const active = document.activeElement
  return !active || active === document.body
}

/* Radix hands focus back to the trigger when closing content unmounts, which for an animated layer is after its exit
   animation. By then the person may already be in the next menu, a popover or the message box: the returned focus closed a
   non-modal menu that had just opened (it dismisses on focus leaving it) or sent the next keystrokes to a button. So focus
   goes back only when it is lost; a caller's own handler still decides first. */
export function returnFocusOnlyWhenLost(onCloseAutoFocus?: (event: Event) => void) {
  return (event: Event) => {
    onCloseAutoFocus?.(event)
    if (!event.defaultPrevented && !focusIsLost()) event.preventDefault()
  }
}
