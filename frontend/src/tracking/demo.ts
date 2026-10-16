/**
 * Whether the simulated walk is offered (TM05-111): in a dev build, or with ?demo=1 in the
 * URL. The flag is remembered for the tab (sessionStorage), so moving between pages keeps
 * it; a production build without it never shows the option.
 */

const KEY = "campsite.demo";

export function canSimulate(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    if (new URLSearchParams(window.location.search).get("demo") === "1") sessionStorage.setItem(KEY, "1");
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
