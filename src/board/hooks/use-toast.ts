import { useCallback, useRef, useState } from "react";

export interface Toast {
  id: string;
  type: "info" | "success" | "error" | "loading";
  message: string;
  retry?: () => void;
  createdAt: number;
}

export interface ToastAPI {
  info: (message: string) => void;
  success: (message: string) => void;
  error: (message: string, retry?: () => void) => void;
  loading: (message: string) => { resolve: (msg: string) => void; reject: (msg: string) => void };
}

export interface UseToastResult {
  toasts: Toast[];
  toast: ToastAPI;
  dismiss: (id: string) => void;
  dismissAll: () => void;
  /** Dismiss oldest error toast, or call its retry. Returns true if handled. */
  handleErrorAction: (action: "dismiss" | "retry") => boolean;
}

const MAX_VISIBLE = 3;
const AUTO_DISMISS_MS = 3000;

let nextId = 0;

export function useToast(): UseToastResult {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clearTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const removeToast = useCallback(
    (id: string) => {
      clearTimer(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    },
    [clearTimer],
  );

  const addToast = useCallback(
    (t: Omit<Toast, "id" | "createdAt">): string => {
      const id = `toast-${++nextId}`;
      const newToast: Toast = { ...t, id, createdAt: Date.now() };

      setToasts((prev) => {
        const next = [...prev, newToast];
        // Enforce max visible: evict oldest dismissable toast
        while (next.length > MAX_VISIBLE) {
          const evictIdx = next.findIndex((x) => x.type !== "error" && x.type !== "loading");
          if (evictIdx >= 0) {
            const evictToast = next[evictIdx];
            if (evictToast) clearTimer(evictToast.id);
            next.splice(evictIdx, 1);
          } else {
            // All are persistent — evict oldest anyway
            const oldest = next[0];
            if (oldest) clearTimer(oldest.id);
            next.shift();
          }
        }
        return next;
      });

      // Auto-dismiss for info/success
      if (t.type === "info" || t.type === "success") {
        const timer = setTimeout(() => removeToast(id), AUTO_DISMISS_MS);
        timersRef.current.set(id, timer);
      }

      return id;
    },
    [removeToast, clearTimer],
  );

  const toast: ToastAPI = {
    info: useCallback(
      (message: string) => {
        addToast({ type: "info", message });
      },
      [addToast],
    ),

    success: useCallback(
      (message: string) => {
        addToast({ type: "success", message });
      },
      [addToast],
    ),

    error: useCallback(
      (message: string, retry?: () => void) => {
        addToast(retry ? { type: "error", message, retry } : { type: "error", message });
      },
      [addToast],
    ),

    loading: useCallback(
      (message: string) => {
        const id = addToast({ type: "loading", message });
        return {
          resolve: (msg: string) => {
            removeToast(id);
            addToast({ type: "success", message: msg });
          },
          reject: (msg: string) => {
            removeToast(id);
            addToast({ type: "error", message: msg });
          },
        };
      },
      [addToast, removeToast],
    ),
  };

  const dismiss = useCallback(
    (id: string) => {
      removeToast(id);
    },
    [removeToast],
  );

  const dismissAll = useCallback(() => {
    for (const timer of timersRef.current.values()) {
      clearTimeout(timer);
    }
    timersRef.current.clear();
    setToasts([]);
  }, []);

  const handleErrorAction = useCallback(
    (action: "dismiss" | "retry"): boolean => {
      const errorToast = toasts.find((t) => t.type === "error");
      if (!errorToast) return false;

      if (action === "retry" && errorToast.retry) {
        removeToast(errorToast.id);
        errorToast.retry();
        return true;
      }
      if (action === "dismiss") {
        removeToast(errorToast.id);
        return true;
      }
      return false;
    },
    [toasts, removeToast],
  );

  return { toasts, toast, dismiss, dismissAll, handleErrorAction };
}
