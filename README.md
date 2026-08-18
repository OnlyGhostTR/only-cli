# OnlyCLI

BYOK (Bring Your Own Key) AI agent CLI. Kendi API anahtarınızla terminalden AI ile kod yazın.

```bash
npm install -g onlycli
onlycli auth add --provider anthropic
onlycli
```

## Özellikler

- AI ile kodunuz hakkında sohbet
- Onay iş akışıyla dosya düzenleme
- Web arama ve sayfa getirme
- Çoklu provider desteği (Anthropic, Google Gemini, OpenAI uyumlu)

## Hızlı Başlangıç

```bash
# API anahtarınızı ekleyin
onlycli auth add --provider anthropic

# İnteraktif sohbet başlatın
onlycli

# Ya da tek seferlik soru sorun
onlycli agent "bu fonksiyondaki hatayı bul" -f src/utils.ts
```

## Komutlar

- `onlycli` veya `onlycli chat` - İnteraktif sohbet (varsayılan)
- `onlycli agent "<prompt>"` - Tek seferlik istek
- `onlycli auth` - API anahtarlarını yönet

## Gereksinimler

- Node.js 18.17+
- Desteklenen bir provider'dan API anahtarı

## Lisans

MIT
