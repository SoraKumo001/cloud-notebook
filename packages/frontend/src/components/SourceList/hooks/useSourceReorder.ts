import {
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { Source } from '../types'

export function useSourceReorder(
  sources: Source[],
  onReorder?: (sourceIds: string[]) => void | Promise<void>,
) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!onReorder || !over || active.id === over.id) return

    const oldIndex = sources.findIndex((s) => s.id === active.id)
    const newIndex = sources.findIndex((s) => s.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(sources, oldIndex, newIndex)
    onReorder(reordered.map((s) => s.id))
  }

  return { sensors, handleDragEnd }
}
