/**
 * Shared drag-and-drop configuration for `@dnd-kit/react`. Client-safe.
 *
 *   <DragDropProvider sensors={contentDragSensors} onDragEnd={...}>
 */
import { KeyboardSensor, PointerSensor } from '@dnd-kit/react'

/**
 * dnd-kit's default sensors (pointer covers mouse, touch and pen; keyboard),
 * except that Enter does not pick up or drop: `<ContentItemCard>` is a link,
 * and Enter must keep opening it. Space picks up and drops, arrow keys move,
 * Escape cancels.
 */
export const contentDragSensors = [
  PointerSensor,
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
