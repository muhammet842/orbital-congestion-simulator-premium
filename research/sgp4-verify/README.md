# SGP4 doğrulaması (Vallado test seti)

**Soru:** Uygulamanın kullandığı SGP4 kütüphanesi (satellite.js 7.1.0), SGP4'ün yayımlanmış referans uygulamasıyla aynı sonucu veriyor mu?

**Neden önemli:** Uygulamadaki her konum, yakın geçiş ve geçiş tahmini bu kütüphaneyle hesaplanır. Kütüphanede bir hata olsaydı, diğer bütün ölçümler de yanlış olurdu.

## Nasıl çalıştırılır

```bash
npm run research:sgp4-verify   # sonuçları results/ klasörüne yazar
npm test                       # aynı kontroller test olarak da çalışır
```

İnternet gerekmez: veri dosyaları `data/` klasöründedir.

## Veri ve kaynak

Vallado, D. A., Crawford, P., Hujsak, R. ve Kelso, T. S. (2006). *Revisiting Spacetrack Report #3.* AIAA/AAS Astrodynamics Specialist Conference, AIAA 2006-6753. Makale ve ekleri: https://celestrak.org/publications/AIAA/2006-6753/

Bu makale, bugün kullanılan SGP4 sürümünü tanımlar ve yazarların kendi uygulamaları ile 33 test durumunun çıktılarını yayımlar. Dosyalar, makalenin "Source code" ekinden (`AIAA-2006-6753.zip`, indirme 2026-11-03) değiştirilmeden alındı:

| Dosya | Zip içindeki yeri | İçerik | SHA-256 |
|---|---|---|---|
| `data/SGP4-VER.TLE` | `sgp4/mat/` | 33 test TLE'si; her birinin üstünde ne test ettiğini anlatan bir not, satır 2'nin sonunda başlangıç, bitiş ve adım süresi (dakika) | `d246d1d9…ffe2881` |
| `data/tmatverDec2015.out` | `sgp4/mat/` | Yazarların MATLAB uygulamasının çıktısı (Aralık 2015): **ana referans** | `60dc65d6…f8414b7` |
| `data/tforverf.out` | `sgp4/for/` | Yazarların Fortran uygulamasının çıktısı: çapraz kontrol | `cbe6f3ed…f1efec7` |

Zip dosyasının SHA-256 özeti: `3642043b706c76be87cf012db3f22e04da6b80498d00f515e51879e0ffadc115`. Özetler, dosyaların kaynaktakiyle birebir aynı olduğunu kontrol etmeye yarar (`sha256sum data/*`).

Referans çıktılar **"afspc" (`'a'`) çalışma kipi ve WGS-72 sabitleriyle** üretilmiştir (MATLAB test programı `testmat.m`: `opsmode = 'a'`, `whichconst = 72`). satellite.js ise **"improved" (`'i'`) kipini** ve WGS-72 sabitlerini kullanır.

## Yöntem

1. Her test TLE'si satellite.js'in `twoline2satrec` fonksiyonuyla okunur. Uygulama da TLE'leri bu fonksiyonla okur.
2. Referans çıktının listelediği **her zaman noktasında** (toplam 666 nokta) `sgp4` ile konum ve hız hesaplanır.
3. Her noktada satellite.js'in konumu ile referansın konumu arasındaki uzaklık (mm) ve hızlar arasındaki fark (mm/s) bulunur. Her test durumu için en büyük fark raporlanır.
4. **Çapraz kontrol:** aynı karşılaştırma Fortran çıktısıyla da yapılır. İki referansın birbirine uzaklığı da ölçülür: en fazla **0,081 mm**. Bu, referans dosyalarının yazdırma hassasiyeti düzeyindedir (konumlar 0,01 mm'ye kadar yazılmıştır).
5. **Hata davranışı:** bazı test TLE'leri bilerek bozuk ya da atmosfere giren nesnelerdir. Referans program bu durumlarda hata verip durur. Referansın durduğu yerden sonraki zamanda satellite.js'in de hata verip vermediği kontrol edilir.
6. **Kip tanısı:** bir farkın kaynağını ayırt etmek için hesap, satellite.js'in kipi `'a'`'ya çevrilerek tekrarlanır. Bu yalnızca bir tanı denemesidir: kip, yörünge okunduktan sonra değiştirildiği için yalnızca hesabın ileri yürütme kısmını etkiler. Uygulama her zaman `'i'` kipini kullanır.
7. **Ayıklanan satır:** MATLAB çıktısının sonunda zamanı geriye giden bir satır vardır. Bu bir ölçüm noktası değildir (Fortran çıktısında yoktur) ve sayılarak dışarıda bırakılır.

## Sonuçlar

([`results/summary.csv`](results/summary.csv), her nokta: [`results/points.csv`](results/points.csv), toplamlar: [`results/totals.json`](results/totals.json))

| Ölçüt | Sonuç |
|---|---|
| Test durumu | 33 (666 nokta) |
| Fark 1 mm'nin altında (uygulamanın `'i'` kipi) | **32 / 33**; en büyük fark 0,008 mm |
| Fark 1 mm'nin altında (`'a'` kipi tanısı) | **33 / 33**; en büyük fark 0,008 mm |
| En büyük hız farkı (32 durum) | 0,001 mm/s |
| Referansın durduğu yerde satellite.js de duruyor | **33 / 33** |
| İki referansın birbirine uzaklığı | en fazla 0,081 mm |

**Tek farklı durum: 23599 (ARIANE 42P+3 R/B).** Test notu: *"Lyddane bug at > 280.5 min"*. Fark 420. dakikadan sonra başlar ve en fazla 964 m olur. Kip `'a'` yapılınca fark 0,008 mm'ye iner. Yani fark bir hesap hatası değildir: Vallado vd.'nin "improved" kipte düzelttiği, belirli derin uzay yörüngelerindeki bilinen Lyddane davranışından kaynaklanır. Referans eski davranışı, satellite.js düzeltilmiş davranışı gösterir.

**Hatayla duran 7 durum.** satellite.js, her birinde referansın durduğu yerden sonraki ilk zamanda hata veriyor:

| NORAD | Referansın hesapladığı nokta / planlanan | satellite.js'in hata verdiği an (dk) | Hata kodu |
|---|---|---|---|
| 22312 | 23 / 72 | 494,2 | 1 |
| 28350 | 13 / 25 | 1.560 | 1 |
| 28872 | 11 / 13 | 55 | 6 |
| 29141 | 22 / 23 | 440 | 6 |
| 33333 | 5 / 31 | 25 | 4 |
| 33334 | 1 / 1.441 (yalnızca epoch satırı) | başlangıçta (TLE okunurken) | 3 |
| 20413 (2. durum) | 70 / 222 | 1.844.345 | 6 |

Hata kodlarının anlamı (Vallado vd. ve satellite.js): **1** ortalama elemanlar geçersiz (eksantriklik ≥ 1 ya da yarı büyük eksen çok küçük) · **3** pertürbe elemanlarda eksantriklik 0–1 dışında · **4** yarı-latus rektum negatif · **6** nesne atmosfere girdi (decayed). 33334'te referans program epoch satırını yazdıktan sonra durur, satellite.js ise aynı hatayı (3) TLE'yi okurken bildirir ve konum döndürmez.

## Yorumlarken dikkat

- Bu doğrulama satellite.js'in **SGP4'ü doğru uyguladığını** gösterir; **SGP4'ün gerçeği ne kadar iyi tahmin ettiğini** göstermez. O soru [`../tle-age/`](../tle-age/README.md) ölçümünün konusudur.
- Test durumları SGP4'ün zor kenar durumlarını (rezonanslı yörüngeler, atmosfere giriş, derin uzay) bilerek içerir; sıradan uydular bunlardan daha kolaydır.
- Doğrulanan, uygulamadaki satellite.js sürümüdür (7.1.0). Sürüm değişirse `npm test` bu kontrolleri tekrarlar ve bir sapma olursa başarısız olur.

## Kodun yapısı

| Dosya | Görev |
|---|---|
| [`lib.mjs`](lib.mjs) | Test ve referans dosyalarını okuma, satellite.js ile karşılaştırma, hata davranışı kontrolü. |
| [`run.mjs`](run.mjs) | Karşılaştırmayı çalıştırır, CSV ve JSON yazar. |
| [`lib.test.ts`](lib.test.ts) | Aynı kontroller test olarak: 32 durum 1 mm içinde (23599 hariç), `'a'` kipinde 33 durum, 7 erken durmanın hepsinde hata. |

## Kaynaklar

- Vallado, D. A., Crawford, P., Hujsak, R. ve Kelso, T. S. (2006). *Revisiting Spacetrack Report #3.* AIAA 2006-6753.
- Hoots, F. R. ve Roehrich, R. L. (1980). *Spacetrack Report No. 3: Models for Propagation of NORAD Element Sets.*
- satellite.js 7.1.0: https://github.com/shashwatak/satellite-js
