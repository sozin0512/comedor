const user = () => window.__HR_MOCK_USER;
export const browserLocalPersistence = {}; export const indexedDBLocalPersistence = {};
const auth = { get currentUser(){ return user(); } };
export const getAuth = () => auth; export const initializeAuth = () => auth;
export async function setPersistence(){}
export function onAuthStateChanged(a, cb){ setTimeout(() => cb(user()), 50); return () => {}; }
export async function signInWithEmailAndPassword(){ return { user: user() }; }
export async function createUserWithEmailAndPassword(){ return { user: user() }; }
export async function sendPasswordResetEmail(){} export async function signOut(){}
