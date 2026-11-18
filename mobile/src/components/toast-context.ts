/**
 * Toast contract. The provider lives in Toast.tsx; this module holds the
 * context + hook so component files export only components.
 *
 * Conventions: success toasts confirm a mutation whose result is not visible
 * where the user is looking; error toasts surface unexpected failures. Form
 * validation stays inline, never in a toast.
 */
import { createContext, useContext } from 'react';
import type { Animated } from 'react-native';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastOptions {
  message: string;
  variant?: ToastVariant;
  /** Milliseconds before auto-dismissal (default 3200). */
  duration?: number;
}

export interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return value;
}

/** The toast on screen now, with the values that animate it in and out. */
export interface ActiveToast {
  id: number;
  message: string;
  variant: ToastVariant;
}

/**
 * Internal: what a toast host needs to draw the current toast. A RN <Modal>
 * (Sheet) covers everything at the root, so a sheet mounts its own host while
 * open; `registerOverlay` hides the root host meanwhile so the toast shows
 * once, on top.
 */
export interface ToastHostValue {
  current: ActiveToast | null;
  translateY: Animated.Value;
  opacity: Animated.Value;
  registerOverlay: () => () => void;
}

export const ToastHostContext = createContext<ToastHostValue | null>(null);
