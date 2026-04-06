import { type ReactNode } from 'react';
import { Drawer } from 'vaul';

interface FluidDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible title (visually hidden, required by Radix) */
  title: string;
  children: ReactNode;
  /** Snap points as fractions of viewport height. Omit for single full-height drawer. */
  snapPoints?: (number | string)[];
  activeSnapPoint?: number | string | null;
  onSnapPointChange?: (snap: number | string | null) => void;
  /** Index from which the overlay starts fading in. Defaults to 0. */
  fadeFromIndex?: number;
  /** Whether the drawer can be dismissed by swiping/clicking overlay. Default true. */
  dismissible?: boolean;
  /** Extra class name on the content element for variant styling. */
  className?: string;
  /** If true, hide the overlay entirely (useful for map sheets where the header must stay clickable). */
  noOverlay?: boolean;
}

/**
 * Unified mobile bottom-sheet drawer built on vaul.
 *
 * Provides buttery-smooth drag-to-dismiss with snap points.
 * Vaul handles all gesture physics, scroll locking, and animations natively.
 */
export default function FluidDrawer({
  open,
  onOpenChange,
  title,
  children,
  snapPoints,
  activeSnapPoint,
  onSnapPointChange,
  fadeFromIndex = 0,
  dismissible = true,
  className,
  noOverlay = false,
}: FluidDrawerProps) {
  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      snapPoints={snapPoints as (number | string)[]}
      activeSnapPoint={activeSnapPoint}
      setActiveSnapPoint={onSnapPointChange}
      fadeFromIndex={fadeFromIndex}
      closeThreshold={0.15}
      dismissible={dismissible}
      modal={!noOverlay}
    >
      <Drawer.Portal>
        {!noOverlay && <Drawer.Overlay className="fd-overlay" />}
        <Drawer.Content className={`fd-content${className ? ` ${className}` : ''}`} aria-describedby={undefined}>
          <Drawer.Title className="sr-only">{title}</Drawer.Title>
          <Drawer.Handle className="fd-handle" />
          {children}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
