import { createContext, useCallback, useContext, useId, useRef, useState } from 'react';
import Modal from './Modal';

const ConfirmContext = createContext(null);

// Demande de confirmation dans une vraie fenêtre de l'ERP (au lieu de window.confirm) :
// const confirm = useConfirm();  if (!(await confirm('Supprimer ?', { confirmLabel: 'Supprimer', danger: true }))) return;
// Le focus part sur « Annuler » : un Entrée réflexe ne déclenche pas l'action.
export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const counter = useRef(0);
  const titleId = useId();
  const messageId = useId();

  const confirm = useCallback(
    (message, options = {}) =>
      new Promise((resolve) => {
        counter.current += 1;
        setRequest({ id: counter.current, message, ...options, resolve });
      }),
    []
  );

  const answer = (value) => {
    request?.resolve(value);
    setRequest(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <Modal
          key={request.id}
          onClose={() => answer(false)}
          className="modal-confirm"
          role="alertdialog"
          labelledBy={titleId}
          describedBy={messageId}
        >
          <h2 id={titleId}>{request.title || (request.danger ? 'Confirmer la suppression' : 'Confirmer')}</h2>
          <p id={messageId} className="confirm-message">
            {request.message}
          </p>
          <div className="modal-actions">
            <span className="spacer" />
            <button type="button" className="btn btn-ghost" onClick={() => answer(false)} data-autofocus>
              Annuler
            </button>
            <button
              type="button"
              className={`btn ${request.danger ? 'btn-danger-solid' : 'btn-primary'}`}
              onClick={() => answer(true)}
            >
              {request.confirmLabel || 'Confirmer'}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
