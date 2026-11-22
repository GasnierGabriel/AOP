import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Comportement accessible commun aux fenêtres modales :
// Échap pour fermer (sauf pendant un envoi), focus placé dans la fenêtre à l'ouverture, Tab qui reste dans la fenêtre,
// focus rendu à l'élément d'origine à la fermeture, et page de fond bloquée (pas de défilement derrière).
export default function useModal({ onClose, busy = false }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    const previous = document.activeElement;
    const node = ref.current;
    // Champ déjà ciblé par autoFocus : on le garde ; sinon premier élément utilisable, ou la fenêtre elle-même
    if (node && !node.contains(document.activeElement)) {
      const first = node.querySelector(FOCUSABLE);
      (first || node).focus({ preventScroll: true });
    }
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (!busyRef.current) closeRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const items = [...ref.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !ref.current.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      if (previous && typeof previous.focus === 'function' && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  return ref;
}
