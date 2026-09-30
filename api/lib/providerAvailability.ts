// Initial release intentionally has no external provider credential store.
// Do not turn this on until credential management and secret storage are designed.
export const externalProvidersAvailable = (): boolean => false;

export const providerUnavailable = {
  success: false,
  error: 'External provider integrations are not available for the initial release',
} as const;
