/**
 * Shared drag-and-drop configuration for `@dnd-kit/react`. Client-safe.
 *
 *   <DragDropProvider sensors={contentDragSensors} onDragEnd={...}>
 */
import { PointerActivationConstraints } from '@dnd-kit/dom'
import { KeyboardSensor, PointerSensor } from '@dnd-kit/react'

/**
 * dnd-kit's default sensors (pointer covers mouse, touch and pen; keyboard),
 * adjusted because `<ContentItemCard>` is a link that must stay clickable:
 *
 * - Mouse and pen start a drag only after moving 5px. dnd-kit's default also
 *   starts one when the button is held 200ms without moving, which turned a
 *   slightly slow click into a drag and swallowed the click.
 * - Touch starts a drag after a 250ms hold (moving more than 5px first
 *   scrolls instead), so a tap still follows the link.
 * - Enter does not pick up or drop, so it keeps opening the link. Space picks
 *   up and drops, arrow keys move, Escape cancels.
 */
export const contentDragSensors = [
  PointerSensor.configure({
    activationConstraints(event) {
      if (event.pointerType === 'touch') {
        return [
          new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 }),
        ]
      }
      return [new PointerActivationConstraints.Distance({ value: 5 })]
    },
  }),
  KeyboardSensor.configure({
    keyboardCodes: {
      start: ['Space'],
      cancel: ['Escape'],
      end: ['Space', 'Tab'],
      up: ['ArrowUp'],
      down: ['ArrowDown'],
      left: ['ArrowLeft'],
      right: ['ArrowRight'],
    },
  }),
]
