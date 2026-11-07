/** Deja importar en Node los módulos del navegador (?v= y .js sin "type": "module"). */
export async function resolve(specifier, context, nextResolve) {
    const q = specifier.indexOf('?');
    const clean = q === -1 ? specifier : specifier.slice(0, q);
    const result = await nextResolve(clean, context);
    if (result.format === 'commonjs' && /\/js\/[^/]+\.js$/.test(result.url || '')) {
        return { ...result, format: 'module' };
    }
    return result;
}
