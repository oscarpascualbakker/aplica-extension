// URL de la oferta que se guarda (CV-504): la de la pestaña. Solo LinkedIn se reescribe:
// en /jobs/search y /jobs/collections la oferta abierta va en `currentJobId`. El resto de la
// normalización la hace el servidor.

export function offerUrl(tabUrl: string): string {
  let url: URL;
  try {
    url = new URL(tabUrl);
  } catch {
    return tabUrl;
  }
  const isLinkedIn = url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com');
  const id = url.searchParams.get('currentJobId');
  if (isLinkedIn && id && /^\d+$/.test(id) && /^\/jobs\/(search|collections)(\/|$)/.test(url.pathname)) {
    return `https://www.linkedin.com/jobs/view/${id}/`;
  }
  return tabUrl;
}
