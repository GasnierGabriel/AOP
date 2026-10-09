import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo } from 'react';

marked.setOptions({ gfm: true, breaks: true }); // tableaux, listes de tâches ; retour à la ligne = <br>

// Liens externes dans un nouvel onglet, sans accès à la page d'origine
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && /^https?:\/\//i.test(node.getAttribute('href') || '')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

// Rendu Markdown, nettoyé (aucun script ni HTML dangereux, même si le texte en contient)
export default function Markdown({ source }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(source || '')), [source]);
  if (!source?.trim()) return <p className="muted">Cette page est vide pour l'instant.</p>;
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
