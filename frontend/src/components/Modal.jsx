import { useLayoutEffect, useRef } from 'react';

// Fermeture par clic à l'extérieur native (closedby="any") : Chrome, Edge, Firefox. Safari : repli ci-dessous.
const SUPPORTS_CLOSEDBY = typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;

// Le clic (appui ET relâchement) a-t-il eu lieu hors de la fenêtre, donc sur le fond ?
// On teste la position et non la cible : le <dialog> est aussi la cible de ses propres marges intérieures.
const isOutside = (e, dialog) => {
  const r = dialog.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
};

// Fenêtre modale native (<dialog> ouvert avec showModal()) : le navigateur gère seul le focus piégé dans la fenêtre,
// la page de fond inerte, Échap / geste retour, et rend le focus au bouton d'origine à la fermeture.
// Montée = ouverte : le parent la retire du rendu pour la fermer (onClose). Pendant un envoi (busy), elle reste ouverte.
// React n'écrit pas l'attribut autofocus : marquer le champ à cibler à l'ouverture avec data-autofocus.
export default function Modal({ onClose, busy = false, className = '', role, labelledBy, describedBy, children }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('[data-autofocus]')?.focus();

    const requestClose = () => {
      if (!busyRef.current) closeRef.current?.();
    };
    // Échap, geste retour, clic sur le fond : c'est React qui ferme (en retirant la fenêtre)
    const onCancel = (e) => {
      e.preventDefault();
      requestClose();
    };
    // Fermeture que le navigateur n'a pas laissé annuler (ex : Échap répété) : on resynchronise
    let unmounting = false;
    const onNativeClose = () => {
      if (unmounting) return;
      if (busyRef.current) dialog.showModal();
      else closeRef.current?.();
    };
    let pressedOutside = false;
    const onPointerDown = (e) => {
      pressedOutside = isOutside(e, dialog);
    };
    const onPointerUp = (e) => {
      if (pressedOutside && isOutside(e, dialog)) requestClose();
      pressedOutside = false;
    };

    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onNativeClose);
    if (!SUPPORTS_CLOSEDBY) {
      dialog.addEventListener('pointerdown', onPointerDown);
      dialog.addEventListener('pointerup', onPointerUp);
    }
    return () => {
      unmounting = true;
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onNativeClose);
      dialog.removeEventListener('pointerdown', onPointerDown);
      dialog.removeEventListener('pointerup', onPointerUp);
      // Fermer avant le retrait du DOM : le navigateur rend alors le focus à l'élément d'origine
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`modal ${className}`.trim()}
      role={role}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      closedby={busy ? 'none' : 'any'}
    >
      {children}
    </dialog>
  );
}
