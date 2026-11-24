// Ayudas de DOM del panel (CV-503, CV-507). Todo el texto va con textContent, nunca con innerHTML.

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function button(text: string, onClick: () => void, secondary = false): HTMLButtonElement {
  const node = el('button', text, secondary ? 'secondary' : undefined);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

/** Acción terciaria (CV-544): un botón con aspecto de enlace, para lo que no compite con la principal. */
export function linkButton(text: string, onClick: () => void): HTMLButtonElement {
  const node = button(text, onClick);
  node.className = 'link';
  return node;
}

/** Las acciones de una pantalla, apiladas y a todo el ancho (CV-544). La principal va la primera. */
export function actions(...nodes: HTMLElement[]): HTMLElement {
  const wrapper = el('div', undefined, 'actions');
  wrapper.append(...nodes);
  return wrapper;
}
