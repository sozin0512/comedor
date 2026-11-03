export const getFunctions = () => ({}); export const httpsCallable = (_f, name) => async (data) => ({ data: (await window.__HR_CALL?.(name, data)) || {} });
