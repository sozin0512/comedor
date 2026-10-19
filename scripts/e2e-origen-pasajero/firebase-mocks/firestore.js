const P = () => (window.__HR_MOCK_PROFILE || {});
export class Timestamp { constructor(s, n=0){ this.seconds=s; this.nanoseconds=n; }
  static now(){ return Timestamp.fromMillis(Date.now()); } static fromMillis(ms){ return new Timestamp(Math.floor(ms/1000), (ms%1000)*1e6); }
  static fromDate(d){ return Timestamp.fromMillis(d.getTime()); } toMillis(){ return this.seconds*1000+Math.floor(this.nanoseconds/1e6); }
  toDate(){ return new Date(this.toMillis()); } valueOf(){ return String(this.toMillis()); } }
export class FieldPath { constructor(...p){ this.p=p; } static documentId(){ return new FieldPath('__name__'); } }
const segs = (a) => a.flatMap(x => typeof x === 'string' ? x.split('/') : []).filter(Boolean);
function mk(type, parts){ const path = parts.join('/'); return { type, path, id: parts[parts.length-1], parent: null, firestore: {} }; }
export function initializeFirestore(){ return { __db: true }; }
export function getFirestore(){ return { __db: true }; }
export const memoryLocalCache = () => ({}); export const persistentLocalCache = () => ({}); export const persistentMultipleTabManager = () => ({});
export function collection(base, ...rest){ const b = base && base.path ? base.path.split('/') : []; return mk('collection', [...b, ...segs(rest)]); }
export function doc(base, ...rest){ const b = base && base.path ? base.path.split('/') : []; let p=[...b, ...segs(rest)]; if (p.length%2===1) p.push('auto'+Math.random().toString(36).slice(2,10)); return mk('document', p); }
export function query(ref, ...c){ return { type:'query', path: ref.path, c }; }
export const where = (...a)=>({where:a}); export const orderBy=(...a)=>({orderBy:a}); export const limit=(n)=>({limit:n});
function docSnap(ref){ const d = window.__HR_MOCK_DOCS?.(ref.path) ?? null; return { id: ref.id, ref, exists: () => d != null, data: () => d ? JSON.parse(JSON.stringify(d)) : undefined, get: (k)=> d ? d[k] : undefined, metadata: { hasPendingWrites:false, fromCache:false } }; }
function qSnap(ref){ const docs=[]; return { docs, empty:true, size:0, forEach:(f)=>docs.forEach(f), docChanges:()=>[], metadata:{ fromCache:false, hasPendingWrites:false }, query: ref }; }
export async function getDoc(ref){ return docSnap(ref); }
export async function getDocs(ref){ return qSnap(ref); }
export function onSnapshot(ref, ...args){ const fns = args.filter(a => typeof a === 'function'); const obj = args.find(a => a && typeof a === 'object' && typeof a.next === 'function'); const next = fns[0] || obj?.next; setTimeout(()=>{ try { next && next(ref.type==='document' ? docSnap(ref) : qSnap(ref)); } catch(e){ console.error('mock onSnapshot cb', ref.path, e); } }, 30); return () => {}; }
const log = (op, ref, data) => { (window.__HR_MOCK_WRITES ||= []).push([op, ref?.path]); };
export async function setDoc(ref, d){ log('set', ref, d); } export async function updateDoc(ref, d){ log('update', ref, d); }
export async function addDoc(ref, d){ log('add', ref, d); return doc(ref); } export async function deleteDoc(ref){ log('delete', ref); }
export const deleteField = () => ({__del:1}); export const serverTimestamp = () => Timestamp.now(); export const increment = (n)=>n; export const arrayUnion = (...a)=>a;
export async function runTransaction(db, fn){ return fn({ get: getDoc, set: (r,d)=>{log('tset',r)}, update:(r,d)=>{log('tupd',r)}, delete:(r)=>{} }); }
