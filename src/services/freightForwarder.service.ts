import { env } from '../config/env';

type ForwarderAccount = {
  first_name: string;
  last_name: string;
  email: string;
  mailboxNumber: string;
  pickupLocation: string;
};

function requireConfig() {
  if (!env.freightForwarderApiToken) throw new Error('Freight-forwarder API token is not configured.');
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  requireConfig();
  const response = await fetch(`${env.freightForwarderBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.freightForwarderApiToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`Freight-forwarder API returned HTTP ${response.status}.`);
  return response.json() as Promise<T>;
}

export function registerForwarderAccount(account: ForwarderAccount) {
  return request('/accounts', { method: 'POST', body: JSON.stringify(account) });
}

export function listForwarderPackages(query = '?limit=25') {
  return request(`/package/my${query}`);
}

export function getForwarderPackage(trackingNumber: string, history = true) {
  return request(`/package/track/${encodeURIComponent(trackingNumber)}?history=${history}`);
}
