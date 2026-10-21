import type { Address } from './types';
import { api } from './api';
export async function findAddress(query: string) {
  return api<Address[]>('/geocode?q=' + encodeURIComponent(query));
}
