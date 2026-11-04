/** Aviso a staff cuando una tienda queda por verificar (ver onStorePendingReviewPush en index.js). */
function storeReviewNotice(before, after, storeId) {
    if (!after || after.approvalStatus !== 'pending') return null;
    if (before && before.approvalStatus === 'pending') return null;
    if (!before && after.createdByStaffUid) return null;
    const name = String(after.name || after.storeName || 'Tienda sin nombre').slice(0, 60);
    const cat = String(after.category || after.type || '').slice(0, 30);
    const city = String(after.cityName || after.city || after.zoneName || '').slice(0, 40);
    const resend = !!before;
    return {
        title: resend ? '🏪 Tienda reenviada a verificación' : '🏪 Nueva tienda por verificar',
        body: `${name}${cat ? ` · ${cat}` : ''}${city ? ` · ${city}` : ''} — revisa en «Verificar tiendas».`,
        data: { type: 'store_pending_review', tag: `store-review-${storeId}`, storeId: String(storeId), openStores: 'true' }
    };
}

module.exports = { storeReviewNotice };
