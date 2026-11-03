# TLE yaşı ve konum farkı

**Soru:** Bir TLE eskidikçe, onunla hesaplanan konum, aynı nesnenin daha güncel bir TLE'sinin verdiği konumdan ne kadar uzaklaşıyor?

> ⚠️ **Bu ölçüm gerçek hatayı değil, iki TLE arasındaki farkı ölçer.** Karşılaştırmada kullanılan "yeni" TLE de bir tahmindir; nesnenin gerçek konumu bilinmez. Sonuçlar "eski TLE, daha güncel tahminden ne kadar sapıyor" diye okunmalıdır. Bu not her CSV dosyasının ilk satırlarında ve her grafiğin altında da yazar.

## Nasıl çalıştırılır

```bash
npm run research:tle-age
# ya da kendi arşiv klasörünle:
npm run research:tle-age -- --archive "C:\Users\...\Documents\tle-archive"
```

- Arşiv klasörü boşsa ya da yoksa, dosyalar depodaki [`tle-archive` release'inden](https://github.com/muhammet842/orbital-congestion-simulator-premium/releases/tag/tle-archive) indirilir (giriş gerekmez) ve `research/data/tle-archive/` klasörüne yazılır (git'e girmez).
- Ölçüm normal bir bilgisayarda yaklaşık 2 dakika sürer. Rastgelelik yoktur: aynı arşiv her zaman aynı sonuçları verir.
- `--split 2026-10-19`: ana dönemin ilk günü (varsayılan).

## Veri

Arşiv, CelesTrak'ın yayımladığı genel kataloğun günlük kopyalarıdır (bkz. [docs/OPERATIONS.md](../../docs/OPERATIONS.md), "TLE archive"). Her gün bir dosya; günde yalnızca bir kopya alındığı için bir nesnenin gün içindeki ara güncellemeleri görülmez.

| Dönem | Günler | Katalog | Nesne | Not |
|---|---|---|---|---|
| **Ana** | 2026-10-19 → 2026-11-02 | 13 | 28.378 | Tam katalog (~28.000 nesne). 21 ve 23 Ekim eksik. |
| **Erken** (ayrı raporlanır) | 2026-07-03 → 2026-10-18 | 47 | 17.159 | ~10.000–12.000 nesnelik katalog; Temmuz–Ağustos'ta 3–4 günde bir, 1–19 Eylül yok. |

İki dönem birbirine karıştırılmaz: katalogdaki nesne seçimi farklı olduğu için ayrı ayrı ölçülür.

## Yöntem, adım adım

1. **Her nesnenin farklı TLE'leri bulunur.** Aynı TLE (aynı epoch) birçok günlük dosyada tekrar edebilir, çünkü arada güncellenmemiştir; böyle bir TLE yalnızca **bir kez** sayılır. Böylece seyrek güncellenen nesneler sonuçta fazla ağırlık kazanmaz. Dönem boyunca TLE'si hiç değişmeyen nesneler karşılaştırılamaz ve sayıları raporlanır.
2. **Yalnızca aynı nesnenin TLE'leri karşılaştırılır** (aynı NORAD numarası). Bir nesnenin her (eski, yeni) TLE çifti bir ölçümdür.
3. **TLE yaşı epoch'lardan hesaplanır, dosya tarihinden değil:** yaş = yeni TLE'nin epoch'u − eski TLE'nin epoch'u (gün). Epoch, TLE satır 1'in 19–32. sütunlarıdır (`26285.85396186` = 2026 yılının 285,85396186. günü). Kod: `epochFromLine1` ([lib.mjs](lib.mjs)).
4. **Konum farkı:** eski TLE, SGP4 modeliyle yeni TLE'nin epoch anına kadar ileri yürütülür; yeni TLE kendi epoch anında hesaplanır. İki konum arasındaki uzaklık km olarak ölçülür. Yeni TLE'nin epoch anı seçilir, çünkü bir TLE kendi epoch'unda en isabetlidir. Hesaplar, uygulamanın da kullandığı satellite.js 7.1.0 kütüphanesiyle yapılır (TEME koordinat sistemi).
5. **Fark üç yöne ayrılır** (yeni TLE'nin o anki yörüngesine göre):
   - **yörünge boyunca** (`along`): nesne yörüngesinde öne ya da geriye kaymış, yani "erken ya da geç kalmış";
   - **radyal** (`radial`): yukarı/aşağı;
   - **yörüngeye dik** (`cross`): sağa/sola.
6. **Gruplar:**
   - Katman (LEO/MEO/GEO/HEO), yeni TLE'nin yörünge biçiminden, **uygulamanın kendi fonksiyonuyla** (`classifyOrbitFromElements`, [src/orbital/classify.ts](../../src/orbital/classify.ts)) bulunur.
   - Starlink uyduları sık manevra yaptığı için ayrıca **STARLINK** grubunda, geri kalan LEO nesneleri **LEO_EXCL_STARLINK** grubunda raporlanır. **STATIONS**: ISS ve Tiangong (yalnızca iki nesne, örnek sayısı küçük).
   - Yaş grupları: en yakın güne yuvarlanmış 0–14 gün (`0` = yarım günden az), sonra `15-30` ve `31+`.
7. **İstatistik (her grup ve yaş için):** örnek sayısı `n`, **ortanca** (ana sonuç), çeyrekler `Q1`–`Q3`, %95'lik değer, ortalama ve örneklem standart sapması. Çeyrekler Excel'in `PERCENTILE.INC` kuralıyla hesaplanır.
8. **Aşırı sapmalar (manevralar):** ana sonuç ortanca olduğu için birkaç manevra sonucu bozmaz. Ayrıca her grupta **Q3 + 3 × (Q3 − Q1)** sınırını aşan çiftler "aykırı" sayılır (Tukey kuralı). Sayıları ve oranları özet tablolarında, en büyük 1.000 tanesi `outliers.csv` dosyasında listelenir.
9. **Hesaplanamayan çiftler dışarıda bırakılır ve sayılır:**
   - **SGP4 hatası:** model hesaplayamadı (çoğunlukla atmosfere girmekte olan nesneler).
   - **Fiziksel olarak imkânsız sonuç:** SGP4 bazen hata vermeden anlamsız bir sonuç döndürür. Örneğin yeni fırlatılmış bir uydunun ilk TLE'si aylar sonrasına yürütüldüğünde milyarlarca km çıkabilir. Tahmin edilen konum Dünya'nın içindeyse ya da Dünya merkezine uzaklığı, nesnenin yeni yörüngesinin en alçak–en yüksek noktası aralığının **1.000 km'den fazla** dışındaysa sonuç geçersiz sayılır (`isPlausiblePosition`). Gerçek değişiklikler bundan çok küçüktür: Starlink yörüngesini yaklaşık 350 km'den 550 km'ye yükseltir.

## Sonuçlar (ana dönem)

Ölçülen çift sayısı: **1.771.754**. Dönem boyunca TLE'si hiç değişmeyen nesne: 228. SGP4 hatası: 570 çift. İmkânsız sonuç: 0.

Ortanca konum farkı (km). Parantez içinde, bu farkın yörünge boyunca olan kısmının ortancası:

| Grup | 1 gün | 3 gün | 7 gün | 14 gün |
|---|---|---|---|---|
| LEO (Starlink hariç) | 0,21 (0,19) | 0,74 (0,69) | 4,09 (4,05) | 22,3 (22,3) |
| Starlink | 9,7 (9,7) | 62,6 (62,6) | 309 (308) | 1.103 (1.039) |
| MEO | 0,21 (0,17) | 0,51 (0,42) | 1,16 (1,00) | 3,25 (3,01) |
| GEO | 0,82 (0,51) | 2,86 (1,74) | 9,50 (6,23) | 26,9 (21,6) |
| HEO | 0,77 (0,62) | 2,42 (2,03) | 9,03 (7,84) | 29,5 (26,0) |
| İstasyonlar (ISS, Tiangong) | 0,53 (n=18) | 3,85 (n=15) | 31,5 (n=14) | 247 (n=2) |

Bütün değerler (çeyrekler, %95, ortalama, standart sapma, radyal ve dik bileşenler, aykırı oranları) [`results/summary-main.csv`](results/summary-main.csv) dosyasındadır. Erken dönem: [`results/summary-early.csv`](results/summary-early.csv) (8.321.979 çift; 24.056 SGP4 hatası, 11.035 imkânsız sonuç). Örneğin erken dönemde ortanca fark, LEO (Starlink hariç) için 1 günde 0,23 km, 7 günde 3,93 km, 14 günde 17,4 km'dir.

Grafikler: [`results/error-vs-age-main.svg`](results/error-vs-age-main.svg), [`results/error-vs-age-early.svg`](results/error-vs-age-early.svg). Bir grafik noktası en az 20 çiftle çizilir; bu yüzden istasyonlar grafikte yoktur.

## Çıktı dosyaları

| Dosya | İçerik |
|---|---|
| `results/summary-main.csv`, `summary-early.csv` | Her grup ve yaş için bir satır (sütunlar aşağıda). |
| `results/error-vs-age-*.svg` | Ortanca fark (çizgi) ve Q1–Q3 bandı, logaritmik y ekseni. Tarayıcıda açılır, Word'e eklenebilir. |
| `results/outliers.csv` | En büyük 1.000 aykırı çift: NORAD, ad, katman, yaş, iki epoch, fark ve bileşenleri. |
| `results/run-info.json` | Kullanılan günler ve sayımlar (nesne, çift, hatalar). |

`summary-*.csv` sütunları: `period` dönem · `group` grup · `age_days` yaş grubu · `n` çift sayısı · `median_km` ortanca · `q1_km`, `q3_km` çeyrekler · `p95_km` %95'lik değer · `mean_km` ortalama · `std_km` standart sapma · `median_abs_along_km`, `median_abs_radial_km`, `median_abs_cross_km` bileşenlerin mutlak değerlerinin ortancası · `outlier_limit_km` Tukey sınırı · `outliers_n`, `outliers_pct` aykırı çift sayısı ve yüzdesi. İlk iki satır `#` ile başlayan nottur; Excel'de açarken bu iki satırı atlayabilirsin.

## Yorumlarken dikkat

- **Gerçek hata değil:** yeni TLE'nin kendi hatası da farka karışır. Özellikle kısa yaşlarda (0–1 gün) ölçülen fark büyük ölçüde iki TLE'nin hatalarının toplamıdır.
- **Çiftler birbirinden bağımsız değil:** aynı TLE birçok çiftte yer alır (örneğin 1. günün TLE'si hem 2. hem 3. günün TLE'siyle karşılaştırılır). Bu yüzden `n` çok büyük olsa da bağımsız gözlem sayısı daha küçüktür; standart sapmayı "ölçüm belirsizliği" gibi yorumlama.
- **Ortalama ve ortanca çok farklı olabilir:** az sayıda çok büyük sapma (manevra, yeni fırlatılmış uydu) ortalamayı büyütür. Bu yüzden ana sonuç ortancadır.
- **Starlink ayrı tutulmalı:** Starlink uyduları sık manevra yapar ve LEO nesnelerinin büyük kısmını oluşturur; "LEO" satırı (Starlink dahil) bu yüzden diğer LEO nesnelerini temsil etmez.
- **Uzun yaşlar (`15-30`, `31+`) seyrek ve özel durumlardır:** ana dönem 14 gün sürdüğü için bu yaşlar yalnızca TLE'si uzun süre güncellenmemiş nesnelerden gelir.
- **Günde tek kopya:** arşiv günde bir kez alındığı için yaşlar 1 günlük adımlarla dağılır; ara güncellemeler görülmez.
- **Eksik günler:** Ekim 21 ve 23 ile erken dönemdeki boşluklar bazı yaş gruplarında örnek sayısını azaltır, sonuçları değiştirmez.

## Kodun yapısı

| Dosya | Görev |
|---|---|
| [`lib.mjs`](lib.mjs) | Hesaplamalar (dosya okuma yok): epoch okuma, TLE eşleme, SGP4 karşılaştırması, bileşenlere ayırma, istatistik. |
| [`run.mjs`](run.mjs) | Arşivi okur, iki dönemi ölçer, CSV, SVG ve JSON yazar. |
| [`chart.mjs`](chart.mjs) | Kütüphanesiz SVG çizgi grafik. |
| [`lib.test.ts`](lib.test.ts) | Testler (`npm test` ile çalışır): örneğin epoch okuma, bileşenlere ayırma ve Tukey sınırı elle doğrulanabilen örneklerle denenir. |

## Kaynaklar

- Hoots, F. R. ve Roehrich, R. L. (1980). *Spacetrack Report No. 3: Models for Propagation of NORAD Element Sets.* SGP4 modelinin tanımı.
- Vallado, D. A., Crawford, P., Hujsak, R. ve Kelso, T. S. (2006). *Revisiting Spacetrack Report #3.* AIAA/AAS Astrodynamics Specialist Conference, AIAA 2006-6753. Bugün kullanılan SGP4 sürümü.
- CelesTrak, genel TLE kataloğu: https://celestrak.org
- satellite.js 7.1.0 (SGP4'ün JavaScript uygulaması): https://github.com/shashwatak/satellite-js
- Tukey, J. W. (1977). *Exploratory Data Analysis.* Addison-Wesley. Aykırı değer kuralı (Q3 + 3 × IQR).
