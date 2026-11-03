# Spotter doğruluğu: ölçüm protokolü

**Soru:** Telefonu bir yöne tuttuğunda Spotter'ın "telefon şu yöne bakıyor" dediği yön, gerçek yönden kaç derece sapıyor?

Spotter, telefonun pusulasını (manyetometre) ve eğim sensörlerini (ivmeölçer, jiroskop) kullanır. Bu sensörlerin hatası, Spotter'ın "sağa 12° dön" gibi yönlendirmelerinin ne kadar güvenilir olduğunu belirler. Bu protokol o hatayı ölçer. **Uydu tahmininin doğruluğunu değil, telefonun yön bulmasının doğruluğunu ölçer**; uydu tahmini [`../tle-age/`](../tle-age/README.md) ve [`../sgp4-verify/`](../sgp4-verify/README.md) ölçümlerinin konusudur.

## İki açı

- **Azimut (yön):** ufukta, coğrafi kuzeyden saat yönünde ölçülen açı. Kuzey 0°, doğu 90°, güney 180°, batı 270°.
- **Yükseklik (eğim):** ufkun üstündeki açı. Ufuk 0°, tam tepe 90°, aşağısı eksi.

Her ölçümde iki hata hesaplanır: **azimut hatası** (telefonun gösterdiği − gerçek; artı ise telefon gerçeğin sağını gösteriyor) ve **yükseklik hatası** (artı ise telefon daha yukarıyı gösteriyor). Ayrıca ikisini birleştiren **toplam hata**: iki yön arasında gökyüzündeki açı. Bir kişinin fark edeceği sayı budur. Toplam hata, uygulamanın kendi fonksiyonuyla (`skyAngularSeparationDeg`) hesaplanır.

**Dikkat:** Spotter'da "telefonun baktığı yön" **arka kameranın baktığı yön**dür, yani ekranın içinden geçip arkaya giden doğrultu. Telefonun üst kenarının gösterdiği yön değildir. Telefonu, ekranına bakarken arkasındaki hedefi "görecek" şekilde tutarsın.

## Telefonun gösterdiği değeri okumak

Spotter'ın normal ekranı yalnızca seçili uyduya göre "sağa 12°" gibi tam sayılı yönlendirmeler verir (hedefe 3°'den yakınsa "hedefte" der); ölçüm için bu yeterince hassas değildir. Bu yüzden ölçümde **ölçüm göstergesi** kullanılır:

1. Siteyi telefonda adresin sonuna `?spotter=measure` ekleyerek aç, örneğin `https://orbital-congestion.vercel.app/?object=25544&spotter=measure` (uydu fark etmez, Spotter'ı açmak için bir uydu seçili olmalıdır).
2. Sağ paneldeki **Spotter** düğmesine bas. Panelde "Ölçüm (araştırma)" kutusu görünür:
   - **Yön**: arka kameranın baktığı yön, coğrafi kuzeyden (manyetik sapma düzeltilmiş), bir ondalıkla.
   - **Eğim**: arka kameranın ufuktan yüksekliği, bir ondalıkla.
   - Altında pusula kaynağı (`absolute` Android, `webkit` iPhone), uygulanan manyetik sapma ve GPS doğruluğu.
   Bunlar, Spotter'ın yönlendirmelerinde kullandığı değerlerin aynısıdır.
3. **Kaydet**: o anki değerleri bir listeye ekler; sayaç ("Kayıt: 12") her basışta artar ve kısa bir süre renklenir. **Pusula güvenilir değilken de kaydeder** (kutunun kenarı sarıya döner): Spotter o durumda yön değeri tutmadığı için satırda yön boş kalır, eğim kaydedilir ve satır `pusula_guvenilir = hayir` olarak, sebebiyle birlikte (`pusula_durumu`) işaretlenir.
4. **Sonuncuyu sil**: yanlış bir basışı geri alır. **Tümünü sil**: onay sorar.
5. **CSV indir**: kayıtları protokolün şablonuyla aynı sütunlarda bir dosya olarak indirir. Telefonun bildiği sütunlar doludur: `tarih_saat`, `telefon` (tarayıcı söylüyorsa model), `tarayici`, `telefon_azimut`, `telefon_yukseklik`, `gps_dogruluk_m`, `mag_sapma`; sonda ayrıca `utc_saat`, `platform` (`iOS` / `Android` / `diger`), `isletim_sistemi` (örneğin `Android 14`, `iOS 17.5`), `pusula_kaynagi`, `pusula_guvenilir`, `pusula_durumu`, `gps_enlem`, `gps_boylam` ve tarayıcının tam kimlik metni `kullanici_araci`. iPhone'lar modelini hiçbir zaman söylemez (yalnızca "iPhone"); Android'de Chrome modeli çoğu zaman verir. Model boşsa `telefon` sütununu kendin doldur. Hedef, gerçek yön ve koşullar sütunlarını sonra Excel'de sen doldurursun.

Kayıtlar telefonun tarayıcısında saklanır: sayfa yenilense ya da ekran kilitlense de kaybolmaz. Yine de her oturumun sonunda CSV'yi indir. Normal adresle (bayraksız) açıldığında Spotter'da hiçbir şey değişmez.

## Gerekenler

- Telefon (ve mümkünse ikinci bir telefon: sonuçların cihaza bağlı olup olmadığını görmek için).
- **Sabit bir destek:** telefon tripodu ya da telefonu dik tutan bir tutucu. Elde tutmak da ölçülebilir ama ayrı kaydedilir.
- **Gerçek su terazisi** (yapı marketlerde satılan; telefonun su terazisi uygulaması olmaz, çünkü ölçtüğümüz sensörü kullanır).
- Uzaktaki yer işaretlerinin koordinatları için Google Maps (ya da benzeri bir harita).
- Gece ölçümü için Stellarium (ücretsiz gökyüzü programı, https://stellarium-web.org) ya da benzeri.
- Bu dosyanın yanındaki şablon: [`data/olcum-sablonu.csv`](data/olcum-sablonu.csv).

## Adım 1: Hazırlık (her ölçüm oturumunun başında)

1. **Açık bir alana çık.** Arabalardan, demir parmaklıklardan, beton içindeki demirden, hoparlörlerden ve elektrik kablolarından en az 2–3 m uzak dur. Manyetik pusula bunlardan etkilenir.
2. **Mıknatıslı kılıfı ve mıknatıslı aksesuarları çıkar** (manyetik araç tutucu plakası, MagSafe cüzdan vb.).
3. **Konumu al:** Spotter'da konum izni ver ve gösterilen GPS doğruluğunun 20 m'nin altına inmesini bekle. (Spotter yalnızca 80 m'nin üstünde uyarır; bu ölçüm için daha iyisi gerekir.) Yer işareti ölçümlerinde kendi konumunu haritadan aldığın için GPS hatası gerçek yönü etkilemez, ama Spotter'ın manyetik sapma hesabı konuma bağlıdır.
4. **Pusulayı kalibre et:** telefonu havada büyük bir "8" çizerek birkaç kez salla. Spotter, pusula hazır değilse bunu ister. Kalibrasyon yapıp yapmadığını kaydet (`kalibrasyon` sütunu). Kalibrasyonun etkisini görmek istersen bazı ölçümleri kalibrasyondan önce de yap.
5. Spotter'ın gösterdiği **manyetik sapma** değerini ("Mag …°") not et (`mag_sapma` sütunu). Spotter pusulanın manyetik kuzeyini bu değerle coğrafi kuzeye çevirir; haritadaki yönler de coğrafi kuzeye göredir.

## Adım 2: Gerçek yönü bilinen hedefler

Üç tür hedef kullan. Her biri hatanın farklı bir yanını ölçer.

### A. Uzak yer işareti (gündüz, azimut ve yükseklik)

Uzakta, haritada yeri kesin belli bir nokta seç: minare, kule, radyo direği, belirgin bir dağ tepesi, uzak bir binanın köşesi.

- **En az 1 km uzakta olsun.** Konumlardaki 10 m'lik bir hata, 1 km'de yaklaşık 0,6°, 3 km'de 0,2° yön hatası yapar. Hedef ne kadar uzaksa, gerçek yön o kadar kesin bilinir.
- **Farklı yönlerde en az 4 hedef seç** (kabaca kuzey, doğu, güney, batı). Pusula hataları çoğu zaman yöne göre değişir; tek yönde ölçmek bunu gizler.
- Koordinatlar: Google Maps'te noktaya uzun bas, çıkan "40.88765, 29.30012" gibi değeri kopyala. Kendi durduğun yeri de aynı şekilde, haritada bul (telefonun GPS'i birkaç metre yanılabilir; haritada durduğun yeri işaretlemek daha kesindir).
- Yükseklikler (deniz seviyesinden, metre): haritanın yükseklik bilgisi ya da https://www.freemaptools.com/elevation-finder.htm gibi bir araç. Kule ve binalarda tepe noktasının yüksekliğini ekle. Yükseklik açısı uzak hedeflerde küçüktür; asıl ölçülen azimuttur.
- Gerçek yönü hesapla:

  ```bash
  npm run research:spotter-direction -- --from 40.88765,29.30012,35 --to 40.90510,29.33120,180
  ```

  Çıktıdaki **gerçek azimut** ve **gerçek yükseklik açısı** şablona yazılır. Koordinatları şablona yazıp gerçek yön sütunlarını boş bırakırsan, analiz betiği bunları kendisi de hesaplar.

### B. Kutup Yıldızı (gece, azimut ve yükseklik)

Kutup Yıldızı (Polaris) gökyüzünde neredeyse hiç hareket etmez: her zaman kuzeyin 1°'den daha yakınındadır ve ufuktan yüksekliği, bulunduğun yerin enlemine yaklaşık eşittir (İstanbul'da yaklaşık 41°). Ölçüm anındaki kesin azimut ve yüksekliğini Stellarium'dan oku (konumu ve saati doğru ayarla) ve şablona yaz. Yükseklik açısının sıfırdan büyük olduğu tek hedef türü budur; eğim ölçümünü yükseklikte de sınar.

Başka parlak yıldızlar ve gezegenler de aynı şekilde kullanılabilir. **Asla Güneş'e doğru bakma ya da telefonun kamerasını Güneş'e tutma.**

### C. Su terazisi (yalnızca yükseklik)

Eğim sensörünü yön sensöründen ayrı sınamak için:

- **Ufuk (0°):** telefonu dik tut, ekranı sana dönük; telefonun yan kenarına su terazisini dayayıp tam dik olduğunu kontrol et. Arka kamera tam ufka bakar: gerçek yükseklik **0°**.
- **Tepe (90°):** telefonu ekranı aşağı bakacak şekilde düz bir masaya koy (masanın düzlüğünü su terazisiyle kontrol et). Arka kamera tam tepeye bakar: **90°**.
- Bu satırlarda **gerçek azimutu boş bırak**: azimut bilinmediği için yalnızca yükseklik hatası hesaplanır. Tepe ölçümünde azimut zaten anlamsızdır (bütün yönler tepede birleşir).

## Adım 3: Ölçüm

Her hedef için:

1. Telefonu desteğe tak ve arka kamerası hedefe bakacak şekilde nişan al. Nişan almak için ekranın üst kenarının ortasından hedefe bak; ekran, bakış çizgine dik olsun.
2. **5 saniye kıpırdatmadan bekle.** Spotter, titremeyi azaltmak için sensör değerlerini yumuşatır; değerin oturması birkaç saniye sürer.
3. Ölçüm göstergesinde **Kaydet**'e bas. (Telefona dokunmak onu oynatabilir; tripoddaysan dokunduktan sonra değerin değişmediğini kontrol et, değiştiyse **Sonuncuyu sil** ve yeniden bekle.) Hangi kaydın hangi hedefe ait olduğunu bir kâğıda not et: "Kayıt 1–10: minare".
4. **Telefonu çıkar, başka bir yöne çevir, sonra yeniden nişan al ve tekrar oku.** Her okuma ayrı bir nişan almadan gelmeli; aksi halde aynı okumayı on kez yazmış olursun.
5. Her hedefte **10 okuma** yap.

**Önerilen asgari plan** (yaklaşık 2–3 saat, iki oturuma bölünebilir):

| Hedef | Koşul | Okuma |
|---|---|---|
| 4 yer işareti (K, D, G, B) | tripod, kalibrasyonlu | 4 × 10 |
| Aynı 4 yer işareti | elde, kalibrasyonlu | 4 × 10 |
| 1 yer işareti | tripod, kalibrasyondan önce | 10 |
| Su terazisi: ufuk ve tepe | masa / dik | 2 × 10 |
| Kutup Yıldızı (gece) | tripod | 10 |
| (İsteğe bağlı) ikinci telefon | aynı plan | — |
| (İsteğe bağlı) bir arabanın 1 m yanında | tripod | 10 |

Son satır, metal ve mıknatısların etkisini göstermek içindir: aynı hedefi arabanın yanında ve uzağında ölçmek, "neden açık alanda ölçmek gerekir" sorusunun sayısal cevabıdır.

**Ne beklemeli:** telefon, metalin yanında da çoğu zaman pusulaya "güvenilir" der ve yine bir yön verir; yalnızca o yön yanlıştır. Bu durumda etki **azimut hatasında** görünür (aynı hedef, arabanın yanında kaç derece farklı gösteriliyor?). Spotter pusulaya güvenmeyi bırakırsa (örneğin kalibrasyon isterse), gösterge bunu sarı renkle ve "Pusula güvenilir değil" yazısıyla söyler; o kayıtlarda yön boştur, ama kaç kez olduğu `pusula_guvenilir` sütunundan sayılabilir. Raporda iki sonuç ayrı yazılmalı: yanlış yön ve hiç yön olmaması.

## Adım 4: Kayıt

Ölçüm göstergesinin indirdiği CSV'yi `data/olcumler.csv` adıyla kaydet (birden çok oturumun dosyalarını Excel'de alt alta birleştirebilirsin; `olcum_no` sütununu baştan numarala) ve kâğıttaki notlarına göre hedef ve koşul sütunlarını doldur. Gösterge yoksa boş şablonu, [`data/olcum-sablonu.csv`](data/olcum-sablonu.csv), elle de doldurabilirsin. Dosya noktalı virgüllüdür, Türkçe Excel'de doğrudan sütunlara ayrılır; ondalık için virgül kullanabilirsin (12,5). Kaydederken "CSV (noktalı virgülle ayrılmış)" seç.

| Sütun | Ne yazılır | Örnek |
|---|---|---|
| `olcum_no` | Sıra numarası | 17 |
| `tarih_saat` | Yerel saatle tarih ve saat | 2026-11-05 14:10 |
| `telefon` | Model | Redmi Note 12 |
| `tarayici` | Tarayıcı ve sürümü | Chrome 130 |
| `hedef_turu` | `yer_isareti`, `kutup_yildizi` ya da `su_terazisi` | yer_isareti |
| `hedef_adi` | Kısa ad | Tuzla minaresi |
| `gozlemci_enlem`, `gozlemci_boylam`, `gozlemci_yukseklik_m` | Durduğun yer (yalnızca yer işaretinde) | 40,88765 · 29,30012 · 35 |
| `hedef_enlem`, `hedef_boylam`, `hedef_yukseklik_m` | Hedefin yeri (yalnızca yer işaretinde) | 40,90510 · 29,33120 · 180 |
| `gercek_azimut`, `gercek_yukseklik` | Gerçek yön (betikten, Stellarium'dan ya da su terazisi testinde 0 / 90). Koordinat yazdıysan boş bırakabilirsin. Su terazisinde azimutu boş bırak. | 53,49 · 2,53 |
| `telefon_azimut`, `telefon_yukseklik` | Ölçüm göstergesinin gösterdiği | 48,5 · 3,1 |
| `gps_dogruluk_m` | Spotter'ın gösterdiği GPS doğruluğu | 5 |
| `mag_sapma` | Spotter'ın gösterdiği manyetik sapma ("Mag …°") | 5,9 |
| `kalibrasyon` | `evet` / `hayir` (8 çizildi mi) | evet |
| `ortam` | `acik_alan`, `ic_mekan` ya da `metal_yakini` | acik_alan |
| `tutus` | `tripod` ya da `el` | tripod |
| `notlar` | Gerekirse: rüzgâr, uyarılar, ne oldu | araba geçti |

Bir satırda bir şey ters gittiyse satırı silme, `notlar` sütununa yaz. Hangi ölçümlerin dışarıda bırakılacağına analizden önce, kuralı yazarak karar ver.

## Adım 5: Analiz

```bash
npm run research:spotter-analyze
```

Betik `data/olcumler.csv` dosyasını okur ve iki dosya yazar:

- `results/errors.csv`: her ölçümün azimut, yükseklik ve toplam hatası.
- `results/summary.csv`: hepsi için ve platforma (iPhone / Android), işletim sistemine, telefona, hedef türüne, kalibrasyona, ortama, tutuşa, pusulanın güvenilir olup olmadığına ve platform + hedef türüne göre gruplar halinde **ortalama** (sistematik sapma: telefon hep bir yöne mi kaçıyor?), **ortanca**, **standart sapma** (dağınıklık: aynı hedefi ne kadar tutarlı gösteriyor?), toplam hatanın ortancası, %95'lik değeri ve en büyüğü.

Pusula güvenilir değilken alınan satırlarda yön boş olduğu için bunlar yalnızca eğim hatasına sayılır; `n_azimut` ve `n_yukseklik` sütunları her ölçütün kaç satırdan hesaplandığını gösterir.

Ortalama ile ortanca birlikte okunmalı: ortalama sıfırdan uzaksa telefonun sistematik bir sapması vardır (örneğin hep 4° sağı gösteriyor); standart sapma büyükse ölçümler dağınıktır.

## Hata kaynakları (raporda tartışılabilecekler)

| Kaynak | Etkisi | Bu protokoldeki önlem |
|---|---|---|
| Manyetik bozulma (metal, mıknatıs, elektrik) | Azimutta onlarca dereceye kadar | Açık alan, kılıfsız; ayrıca bilinçli bir "metal yakını" ölçümü |
| Pusula kalibrasyonu | Azimutta birkaç ile onlarca derece | 8 çizme; kalibrasyon öncesi/sonrası karşılaştırması |
| Nişan alma | Yaklaşık 1–2° | Tripod; her okumada yeniden nişan; elde/tripod karşılaştırması |
| Hedefin gerçek yönü | Konum hatası / uzaklık (1 km'de 10 m → 0,6°) | En az 1 km uzak hedef, haritada işaretlenmiş konum |
| Manyetik sapma (declination) modeli | Genelde 1°'den küçük | `mag_sapma` kaydedilir |
| Sensör yumuşatması | Okuma oturmadan yazılırsa birkaç derece | 5 saniye bekleme |
| Telefon modeli | Sensörler cihaza göre değişir | İsteğe bağlı ikinci telefon |

## Güvenlik

- Güneş'e asla doğrudan ya da telefonun kamerasıyla bakma.
- Gece ölçümünde güvenli, aydınlık ve tanıdık bir yerde, yanında biriyle ol.
- Yol kenarında ölçüm yapma.

## Dosyalar

| Dosya | Görev |
|---|---|
| [`../../src/ui/spotter/measureTool.ts`](../../src/ui/spotter/measureTool.ts) | Uygulamadaki ölçüm göstergesi (`?spotter=measure`): okuma, kaydetme, CSV indirme. |
| [`sheet.test.ts`](sheet.test.ts) | Göstergenin indirdiği dosyanın şablonla aynı sütunlarda olduğunu ve analizin onu okuyabildiğini denetler. |
| [`data/olcum-sablonu.csv`](data/olcum-sablonu.csv) | Boş şablon (noktalı virgüllü, Excel'e uygun). |
| [`true-direction.mjs`](true-direction.mjs) | İki koordinattan gerçek azimut, yükseklik açısı ve uzaklık. |
| [`analyze.mjs`](analyze.mjs) | Doldurulmuş tabloyu özetler. |
| [`lib.mjs`](lib.mjs), [`lib.test.ts`](lib.test.ts) | Hesaplar ve testleri (yönlerin doğruluğu, kuzeyde 359° ile 2° arasının 3° olması, Excel'in noktalı virgüllü CSV'si). |

Gerçek yön, iki nokta WGS-84 elipsoidi üzerinde Dünya merkezli koordinatlara çevrilip gözlemcinin doğu–kuzey–yukarı eksenlerine döndürülerek hesaplanır; Dünya'nın eğriliği bu sayede hesaba katılır. Havadaki ışık kırılması dahil değildir (birkaç km'de 0,05°'den az).
