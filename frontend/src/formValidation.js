// Les lecteurs d'écran ne voient pas la pseudo-classe CSS :user-invalid (champ en erreur après saisie ou envoi) :
// on recopie cet état dans aria-invalid sur tous les champs du site. Un aria-invalid="true" posé par ailleurs
// (ex : vérification serveur) n'est pas retiré.
const FIELDS = 'input, select, textarea';
const flagged = new WeakSet();

function syncAria(el) {
  if (!el?.matches?.(FIELDS)) return;
  let invalid;
  try {
    invalid = el.matches(':user-invalid');
  } catch {
    return; // navigateur trop ancien : on garde le comportement natif
  }
  if (invalid) {
    el.setAttribute('aria-invalid', 'true');
    flagged.add(el);
  } else if (flagged.has(el)) {
    el.setAttribute('aria-invalid', 'false');
    flagged.delete(el);
  }
}

export default function installFormValidation() {
  // Sortie du champ (afficher l'erreur), saisie (l'effacer dès qu'elle est corrigée),
  // changement (cases, listes) et envoi refusé (« invalid » sur chaque champ fautif, même jamais touché).
  document.addEventListener('blur', (e) => syncAria(e.target), true);
  document.addEventListener('input', (e) => e.target?.hasAttribute?.('aria-invalid') && syncAria(e.target), true);
  document.addEventListener('change', (e) => syncAria(e.target), true);
  document.addEventListener('invalid', (e) => syncAria(e.target), true);
}
