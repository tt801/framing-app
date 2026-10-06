export function signInForSupport() {
  return '#/login?next=support'
}

export function loginDestination(hash: string) {
  const params = new URLSearchParams(hash.split('?')[1] || '')
  return params.get('next') === 'support' ? '#/support' : '#/dashboard'
}
