export function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

export function jsonHeaders(token, extra) {
  return Object.assign(
    {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    extra,
  );
}

export function readRideId(response) {
  const body = readJson(response);
  if (!body || typeof body.id !== 'string' || body.id.length === 0) {
    return null;
  }
  return body.id;
}

export function readStatus(response) {
  const body = readJson(response);
  return body && typeof body.statusCorrida === 'string' ? body.statusCorrida : '';
}

export function readJson(response) {
  try {
    return response.json();
  } catch (error) {
    return null;
  }
}

export function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (symbol) => {
    const random = Math.floor(Math.random() * 16);
    const value = symbol === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function trimSlash(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
