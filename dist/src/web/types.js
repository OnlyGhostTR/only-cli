/**
 * Web katmanının yaprak tipleri.
 *
 * Ayrı dosyada duruyor çünkü `config/store.ts` arama anahtarlarını saklamak
 * için bu tiplere ihtiyaç duyuyor; arama uygulaması ise store'u kullanıyor.
 * Tipler burada olmasa iki modül birbirini import ederdi.
 */
/** Anahtar gerektiren arama sağlayıcıları. */
export const SEARCH_BACKENDS = ["brave", "tavily"];
export function isSearchBackendId(value) {
    return SEARCH_BACKENDS.includes(value);
}
export const SEARCH_SOURCE_LABELS = {
    brave: "Brave Search",
    tavily: "Tavily",
    duckduckgo: "DuckDuckGo (anahtarsız)",
};
//# sourceMappingURL=types.js.map