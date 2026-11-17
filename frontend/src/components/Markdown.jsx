import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useEffect, useMemo, useRef } from 'react';

marked.setOptions({ gfm: true, breaks: true }); // tableaux, listes de tâches ; retour à la ligne = <br>

// Liens externes dans un nouvel onglet, sans accès à la page d'origine
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && /^https?:\/\//i.test(node.getAttribute('href') || '')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

// Mermaid (lourd) n'est chargé que si une page contient un diagramme
let mermaidPromise = null;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict', // pas de HTML ni de clics/scripts dans les libellés
        htmlLabels: false, // libellés en texte SVG : rien de HTML à injecter, et ils survivent au nettoyage DOMPurify
        flowchart: { htmlLabels: false },
        theme: 'base',
        fontFamily: 'Poppins, Arial, sans-serif',
        themeVariables: {
          primaryColor: '#e8ecf5',
          primaryBorderColor: '#000f2e',
          primaryTextColor: '#000f2e',
          lineColor: '#000f2e',
          secondaryColor: '#fde8ea',
          tertiaryColor: '#f3f4f7',
        },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

let diagramCount = 0;

// Remplace les blocs ```mermaid par le diagramme rendu ; en cas d'erreur, garde le code et affiche l'erreur
async function renderDiagrams(container, isCancelled) {
  const blocks = [...container.querySelectorAll('pre > code.language-mermaid')];
  if (blocks.length === 0) return;
  const mermaid = await loadMermaid();
  for (const code of blocks) {
    if (isCancelled()) return;
    const pre = code.parentElement;
    const source = code.textContent;
    diagramCount += 1;
    const id = `mermaid-${diagramCount}`;
    try {
      const { svg } = await mermaid.render(id, source);
      if (isCancelled() || !pre.isConnected) return;
      const figure = document.createElement('div');
      figure.className = 'mermaid-diagram';
      figure.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { html: true, svg: true, svgFilters: true }, ADD_TAGS: ['foreignObject'] });
      pre.replaceWith(figure);
    } catch (err) {
      document.getElementById(`d${id}`)?.remove(); // conteneur temporaire laissé par mermaid en cas d'erreur
      if (isCancelled() || !pre.isConnected) return;
      const message = document.createElement('p');
      message.className = 'mermaid-error';
      message.textContent = `Diagramme Mermaid invalide : ${String(err?.message || err).split('\n')[0]}`;
      pre.after(message);
    }
  }
}

// Rendu Markdown, nettoyé (aucun script ni HTML dangereux, même si le texte en contient), avec diagrammes Mermaid
export default function Markdown({ source }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(source || '')), [source]);
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return undefined;
    let cancelled = false;
    // Petit délai : dans l'aperçu de l'éditeur, on ne redessine pas à chaque touche
    const timer = setTimeout(() => renderDiagrams(ref.current, () => cancelled).catch(() => {}), 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [html]);

  if (!source?.trim()) return <p className="muted">Cette page est vide pour l'instant.</p>;
  return <div ref={ref} className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
