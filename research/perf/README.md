# Performans: nesne sayısı ve Web Worker

**Sorular:**
1. Bir anın konumlarını hesaplamak, nesne sayısına göre ne kadar sürüyor?
2. Tarayıcıda Web Worker'lar açıkken ve kapalıyken kare süresi, ana iş parçacığının (main thread) yükü ve 24 saatlik yakın geçiş taramasının süresi nasıl değişiyor?

Nesne sayıları: **1.000 / 5.000 / 10.000 / 28.000**.

## Uygulamadaki ölçüm bayrakları

Normal kullanımda hiçbiri açık değildir; açık olmadığında uygulama birebir eskisi gibi çalışır (bkz. [`src/perfFlags.ts`](../../src/perfFlags.ts) ve testleri).

| Adres | Ne yapar |
|---|---|
| `?worker=off` | Hiç Web Worker başlatılmaz. Konumlar ve yakın geçiş taraması ana iş parçacığında, uygulamanın worker'ı olmayan tarayıcılar için zaten var olan yedek yoluyla çalışır. Yeni bir hesap yolu eklenmedi. |
| `?limit=5000` | Katalogdan 5.000 nesne seçilir: NORAD numarasına göre sıralanıp eşit aralıkla (`pickEvenly`). Her seferinde aynı nesneler seçilir ve yörünge türlerinin oranı korunur. |
| (her zaman) | `performance.mark` işaretleri: `catalog-ready` (katalog çizilmeye hazır), `conjunction-scan-start` ve `conjunction-scan-done` (24 saatlik tarama başladı / bitti). Kullanıcıya hiçbir şey göstermez; ölçüm betiği bunları okur. |

## 1. Hesap süresi (Node)

```bash
npm run research:perf-node
```

- Uygulamanın kendi `propagateObject` fonksiyonu ([`src/orbital/propagator.ts`](../../src/orbital/propagator.ts)) kullanılır: konum worker'ının (ya da `?worker=off` ile ana iş parçacığının) her katalog güncellemesinde yaptığı iş budur. Çizim yoktur.
- Nesneler, arşivin 2026-11-02 dosyasından `?limit` ile aynı `pickEvenly` fonksiyonuyla seçilir (28.000 için 28.297'den 28.000).
- Her nesne sayısı için önce 5 ısınma turu (sayılmaz: JavaScript motoru kodu bu sırada hızlandırır), sonra **30 ölçüm**. Her ölçümde farklı bir dakika hesaplanır, böylece hiçbir sonuç yeniden kullanılamaz.
- Node, uygulamanın `.ts` dosyalarını uzantısız içe aktarma yazımını kendisi çözemediği için küçük bir yardımcı kullanılır ([`ts-hooks.mjs`](ts-hooks.mjs)): bulunamayan bir yol için `.ts` uzantısını dener. Uygulama koduna dokunmaz.

**Sonuç** (AMD Ryzen 5 7520U, Node 24.17.0; [`results/sgp4-node-summary.csv`](results/sgp4-node-summary.csv)):

| Nesne | Ortanca | Standart sapma | Nesne başına |
|---|---|---|---|
| 1.000 | 2,27 ms | 0,42 ms | 2,27 µs |
| 5.000 | 10,97 ms | 0,52 ms | 2,19 µs |
| 10.000 | 22,74 ms | 1,46 ms | 2,27 µs |
| 28.000 | 61,49 ms | 0,68 ms | 2,20 µs |

Karşılaştırma için: 60 Hz bir ekranda bir kareye 16,7 ms düşer.

## 2. Tarayıcı ölçümü (Playwright, Microsoft Edge)

```bash
npm run pull-data            # güncel katalog (public/data/tle.json'ı değiştirir)
npm run build
git checkout -- public/data/tle.json   # değişikliği geri al, commit'e girmesin
npm run research:perf-browser -- --phase frames   # kare ölçümleri, ~1,5 saat
npm run research:perf-browser -- --phase scan     # tarama süreleri, saatler sürebilir
```

Betik `vite preview` sunucusunu kendisi başlatır ve kapatır, **görünür (headed) bir Edge penceresi** açar.

### Ölçülenler

**Kare ölçümü** (her nesne sayısı × worker açık/kapalı × CPU normal/4 kat yavaş, **10 tekrar**; her tekrar yeni bir sayfa):
- Sayfa açılır, `catalog-ready` işaretinden sonra **10 saniye** beklenir (yükleme otursun), sonra **15 saniye** ölçülür.
- `fps`, `frame_median_ms`, `frame_p95_ms`: `requestAnimationFrame` ile ölçülen kareler arası süre.
- `frames_over_50ms`: 50 ms'den uzun süren kare sayısı (göze "takılma" olarak görünür).
- `main_thread_busy_pct`: ana iş parçacığının ölçüm penceresinde meşgul olduğu sürenin oranı. Chrome'un kendi sayacından (`Performance.getMetrics`, `TaskDuration`) alınır. Worker'ın faydası en açık burada görünür: worker'daki iş bu sayaca girmez.
- `long_tasks`, `long_task_ms`: 50 ms'den uzun ana iş parçacığı görevleri (Long Tasks API).
- `ready_ms`: sayfa açılışından katalogun hazır olmasına kadar geçen süre.

**Tarama ölçümü** (her nesne sayısı × worker açık/kapalı, varsayılan 3 tekrar): `conjunction-scan-start` ile `conjunction-scan-done` arasındaki süre. Varsayılan 15 dakikada bitmezse "bitmedi" olarak kaydedilir (`--scan-cap-min`).

### Adil ölçüm için

- **Dönüşümlü sıra:** ölçümler worker açık/kapalı ve CPU hızı arasında sırayla yapılır, her tekrarda sıra tersine döner. Bilgisayar ısındıkça yavaşlarsa bu etki iki tarafa eşit dağılır.
- **Görünür pencere:** pencere arka planda kalınca tarayıcı çizimi yavaşlatır; bunu engelleyen Chrome ayarları açıktır (`--disable-backgrounding-occluded-windows` vb.). **Yine de ölçüm sırasında bilgisayarı kullanma, başka program açma.**
- **Ortam kaydı** (`results/browser-env.json`): tarayıcı sürümü, headed olup olmadığı, **ekran yenileme hızı** (boş bir sayfada 3 saniye kare aralığı ölçülerek), ekran kartı, işlemci, bellek, işletim sistemi, prize takılı olup olmadığı, pencere boyutu (1440×900).
- Her ölçüm satırı yazıldığı anda dosyaya kaydedilir; ölçüm yarıda kesilirse o ana kadarki veri kaybolmaz.

### Yorumlarken dikkat

- **Kareler ekran hızıyla sınırlıdır.** 60 Hz bir ekranda kare süresi 16,7 ms'nin altına inemez; bu yüzden ortanca kare süresi iki durumda da 16,7 ms çıkabilir. Fark `main_thread_busy_pct`, `frame_p95_ms` ve takılma sayılarında aranmalıdır.
- **CPU yavaşlatması worker'ları yavaşlatmayabilir.** Chrome'un `Emulation.setCPUThrottlingRate` aracı sayfanın ana iş parçacığını yavaşlatır; Web Worker'ların da yavaşladığı garanti değildir. Bu, 4 kat turunda sonucu worker'ın lehine çevirebilir. Yavaş bir telefonun yerini tutmaz, yalnızca bir yaklaşık deneydir.
- **Worker kapalıyken uygulama kendini korur.** Konumların tamamı ana iş parçacığında her kare değil, saniyede en fazla 4 kez hesaplanır (`SYNC_FALLBACK_QUANTUM_MS = 250`, [`src/scene/SceneManager.ts`](../../src/scene/SceneManager.ts)). Bu yüzden worker kapalıyken FPS beklenenden iyi görünebilir; bedeli ana iş parçacığı yükü ve takılmalardır.
- **Worker kapalıyken tarama süresini hesap gücü değil dilimleme belirler.** Yedek yol ekranı dondurmamak için taramayı küçük parçalara böler (en fazla 1.000 nesnelik bir hesap) ve her parçayı tarayıcı boşta kaldığında (`requestIdleCallback`), çoğunlukla karede bir kez çalıştırır ([`src/orbital/conjunction/upcomingScan.ts`](../../src/orbital/conjunction/upcomingScan.ts)). 24 saatlik tarama 1.440 zaman adımıdır. Deneme ölçümünde 1.000 nesne için tarama worker açıkken 2,6 saniye, kapalıyken 124 saniye sürdü; 28.000 nesnede worker kapalıyken 10 dakikada bitmedi.
- **Tek bir bilgisayar:** sonuçlar bu bilgisayara ve ekran kartına özgüdür; başka cihazlarda sayılar değişir, oranlar daha anlamlıdır.

## Dosyalar

| Dosya | İçerik |
|---|---|
| `sgp4-node.mjs` | Hesap süresi ölçümü (Node). |
| `browser-bench.mjs` | Tarayıcı ölçümü (Playwright). |
| `register-ts.mjs`, `ts-hooks.mjs` | Node'un uygulamanın `.ts` dosyalarını içe aktarabilmesi için. |
| `results/sgp4-node-summary.csv`, `-runs.csv`, `-env.json` | Hesap süresi: özet, her ölçüm, ortam. |
| `results/browser-summary.csv`, `-runs.csv`, `-scan.csv`, `-env.json` | Tarayıcı: özet (her ölçüt için ortanca ve standart sapma), her ölçüm, tarama süreleri, ortam. |

## Kaynaklar

- Chrome DevTools Protocol: `Performance.getMetrics`, `Emulation.setCPUThrottlingRate`. https://chromedevtools.github.io/devtools-protocol/
- W3C Long Tasks API. https://w3c.github.io/longtasks/
- W3C `requestIdleCallback`. https://w3c.github.io/requestidlecallback/
- Playwright. https://playwright.dev
