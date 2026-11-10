export function messageId() {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), part => part.toString(16).padStart(8, '0')).join('');
}

export function openRoomSocket(pin: string) {
  const url = new URL(`/api/rooms/${pin}/ws`, location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return new WebSocket(url);
}
