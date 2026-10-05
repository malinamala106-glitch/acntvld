'use client'

// Admin product ordering: drag-and-drop reorder + pin-to-top.
//
// Split out of AdminApp.tsx because the drag-and-drop state machine is much
// easier to reason about on its own, and so an unrelated re-render of the
// dashboard (the 30s unread poll, a stats refresh) cannot reset an in-progress
// drag or clobber a pending save.
//
// The provider owns two things: the optimistic ordering shown on screen, and
// the debounced write that persists it. Cards consume `useSortableRow(id)` for
// their own drag ref/handle, so AdminApp's existing AdminProductCard keeps its
// shape and its existing buttons untouched.
//
// Ordering contract, shared with the storefront (see lib/cache.ts and
// app/api/products/route.ts): pinned rows float to the top, everything else
// follows sortOrder ascending. The server is the source of truth; this file
// renders the order it sends and pushes back the whole list after a drop.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

/**
 * The fields of a product that ordering actually cares about.
 *
 * `pinned` is optional because a row produced before the pin column existed
 * (or a hand-written payload) may omit it; every read below normalises it.
 */
export interface OrderableProduct {
  id: string
  name: string
  pinned?: boolean
}

interface OrderContextValue {
  items: OrderableProduct[]
  saving: boolean
  /** id of the product whose pin request is in flight, else null. */
  pinBusyId: string | null
  togglePin: (id: string) => void
  moveBy: (id: string, delta: number) => void
  /** False at the top of a pin block, or for the first row overall. */
  canMoveUp: (id: string) => boolean
  /** False at the bottom of a pin block, or for the last row overall. */
  canMoveDown: (id: string) => boolean
}

const OrderContext = createContext<OrderContextValue | null>(null)

export function useProductOrder(): OrderContextValue {
  const ctx = useContext(OrderContext)
  if (!ctx) throw new Error('useProductOrder must be used inside <ProductOrderList>')
  return ctx
}

/** Per-row drag wiring. Returns the ref, transform and the drag handle. */
export function useSortableRow(id: string) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id })
  return {
    setNodeRef,
    isDragging,
    style: {
      transform: CSS.Transform.toString(transform),
      transition,
      // Lift the dragged row above its siblings for the duration of the drag.
      zIndex: isDragging ? 30 : undefined,
      position: 'relative' as const,
    },
    dragHandleProps: { ...attributes, ...listeners },
  }
}

/** Save debounce. Long enough to coalesce a burst of arrow presses. */
const SAVE_DEBOUNCE_MS = 500

interface Props<T extends OrderableProduct> {
  /** Server-ordered list. The provider renders exactly this order. */
  products: T[]
  /**
   * Persist the ordering. Receives EVERY product id in display order — never
   * a filtered subset, because the server rewrites sortOrder from array index.
   */
  onReorder: (ids: string[]) => Promise<void>
  /** Persist one pin toggle. Throwing rolls the row back. */
  onPin: (id: string, pinned: boolean) => Promise<void>
  /** Called after a successful pin so the parent can refresh its data. */
  onPinSuccess: () => void
  /** Render the rows. Called in the provider's optimistic order. */
  children: (product: T, index: number) => React.ReactNode
}

/**
 * Generic over the product type so the row's own fields survive the ordering
 * logic — the consumer renders its full card, not just id/name/pinned.
 */
export function ProductOrderList<T extends OrderableProduct>({
  products,
  onReorder,
  onPin,
  onPinSuccess,
  children,
}: Props<T>) {
  // Optimistic order. `products` is the server order; `items` may briefly hold
  // a newer order the server has not acknowledged yet.
  const [items, setItems] = useState<T[]>(products)
  const [saving, setSaving] = useState(false)
  const [pinBusyId, setPinBusyId] = useState<string | null>(null)

  // Refs, not state: a pending save must not be cancelled by re-rendering.
  const latestProducts = useRef(products)
  latestProducts.current = products

  // Resync when the server sends a new list (reload, create, delete). Without
  // this the optimistic order would win forever and mask changes made in
  // another tab.
  useEffect(() => {
    setItems(products)
  }, [products])

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<string[] | null>(null)

  const flush = useCallback(async () => {
    const ids = pendingRef.current
    pendingRef.current = null
    if (!ids) return
    setSaving(true)
    try {
      await onReorder(ids)
    } finally {
      setSaving(false)
    }
  }, [onReorder])

  const scheduleSave = useCallback(
    (ids: string[]) => {
      pendingRef.current = ids
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        void flush()
      }, SAVE_DEBOUNCE_MS)
    },
    [flush],
  )

  // On unmount (admin switched views, logged out) fire a still-pending save
  // immediately — clearing the timer would silently drop the last drop.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
      const ids = pendingRef.current
      pendingRef.current = null
      if (ids) void onReorder(ids)
    }
  }, [onReorder])

  const sensors = useSensors(
    // A small activation distance stops a click on a card button from starting
    // a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Touch needs a deliberate hold, otherwise scrolling the page over a card
    // is always read as a drag.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const from = items.findIndex((p) => p.id === active.id)
      const to = items.findIndex((p) => p.id === over.id)
      if (from < 0 || to < 0) return

      // Dragging across the pinned boundary is a no-op: floating a product
      // above the pinned group is what the pin toggle is for. Clamping keeps
      // drag and arrows consistent instead of letting them disagree.
      if (items[from].pinned !== items[to].pinned) return

      const next = arrayMove(items, from, to)
      setItems(next)
      scheduleSave(next.map((p) => p.id))
    },
    [items, scheduleSave],
  )

  /**
   * Move one row by one position — the touch/mobile fallback for dragging.
   * Same pinned-boundary rule as the drag handler.
   */
  const moveBy = useCallback(
    (id: string, delta: number) => {
      const from = items.findIndex((p) => p.id === id)
      if (from < 0) return
      const to = from + delta
      if (to < 0 || to >= items.length) return
      if (items[from].pinned !== items[to].pinned) return
      const next = arrayMove(items, from, to)
      setItems(next)
      scheduleSave(next.map((p) => p.id))
    },
    [items, scheduleSave],
  )

  /**
   * A row may only move within its own pinned block. Crossing the boundary is
   * the pin toggle's job, so the arrows disable there instead of performing a
   * move the drag handler would refuse anyway.
   */
  const neighbourIsSameBlock = useCallback(
    (id: string, delta: number) => {
      const from = items.findIndex((p) => p.id === id)
      if (from < 0) return false
      const to = from + delta
      if (to < 0 || to >= items.length) return false
      return items[from].pinned === items[to].pinned
    },
    [items],
  )

  const canMoveUp = useCallback(
    (id: string) => neighbourIsSameBlock(id, -1),
    [neighbourIsSameBlock],
  )
  const canMoveDown = useCallback(
    (id: string) => neighbourIsSameBlock(id, 1),
    [neighbourIsSameBlock],
  )

  const togglePin = useCallback(
    (id: string) => {
      const target = items.find((p) => p.id === id)
      if (!target || pinBusyId) return
      const next = !target.pinned
      setPinBusyId(id)

      // Optimistic: show the row where it is about to end up.
      setItems((prev) => {
        const flipped = prev.map((p) => (p.id === id ? { ...p, pinned: next } : p))
        if (!next) {
          // Unpinning keeps the row's manual slot, so it drops straight back
          // into its old position — only `pinned` changed.
          return flipped
        }
        // Pinning floats it to the top, preserving the relative order of the
        // rows already pinned.
        return [...flipped.filter((p) => p.pinned), ...flipped.filter((p) => !p.pinned)]
      })

      void (async () => {
        try {
          await onPin(id, next)
          onPinSuccess()
        } catch {
          // Roll back to the last server-acknowledged order.
          setItems(latestProducts.current)
        } finally {
          setPinBusyId(null)
        }
      })()
    },
    [items, pinBusyId, onPin, onPinSuccess],
  )

  const ids = useMemo(() => items.map((p) => p.id), [items])

  const value = useMemo(
    () => ({ items, saving, pinBusyId, togglePin, moveBy, canMoveUp, canMoveDown }),
    [items, saving, pinBusyId, togglePin, moveBy, canMoveUp, canMoveDown],
  )

  return (
    <OrderContext.Provider value={value}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          {items.map((product, index) => children(product, index))}
        </SortableContext>
      </DndContext>
    </OrderContext.Provider>
  )
}