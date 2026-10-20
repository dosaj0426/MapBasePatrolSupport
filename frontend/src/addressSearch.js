import { api } from './api.js';
export async function findAddress(query) {
  return api('/geocode?q=' + encodeURIComponent(query));
}
