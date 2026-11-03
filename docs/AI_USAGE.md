# Yapay zekâ kullanımı

Bu proje geliştirilirken yapay zekâ araçları **yoğun olarak** kullanıldı. Bu belge, hangi araçların, hangi dönemde, hangi işlerde kullanıldığını ve sonuçların nasıl denetlendiğini dürüstçe anlatır. Git geçmişi hiçbir zaman yeniden yazılmadı; yapay zekânın izleri (commit satırları, `.cursor/rules/` dosyaları) depoda olduğu gibi duruyor.

*Son güncelleme: 3 Kasım 2026.*

## Kullanılan araçlar ve dönemler

| Dönem | Araç | Git geçmişindeki iz |
|---|---|---|
| Temmuz – Eylül 2026 | **Cursor**: yapay zekâ destekli kod editörü | 8 Temmuz – 2 Eylül arasında **171 commit**'te `Co-authored-by: Cursor` satırı. `.cursor/rules/` klasöründeki iki dosya (`project-map.mdc`, `tle-refresh.mdc`), Cursor'daki yapay zekâya projeyi tanıtan kurallardır (2 Eylül'de eklendi). |
| 12 Ekim 2026'dan beri | **Claude Code** (Anthropic): Claude Opus 5.5 ve Claude Sonnet 5.5 modelleri | 12–15 Ekim arasında **36 commit**'te `Co-Authored-By: Claude …` satırı; PR #1–#12'nin açıklamasında "Generated with Claude Code" notu. |

### ⚠️ Git geçmişinde görünmeyen katkı

Öğrencinin isteğiyle, Claude Code PR açıklamalarına "Generated with Claude Code" notunu PR #13'ten (14 Ekim 2026) itibaren, commit'lere `Co-Authored-By: Claude` satırını 15 Ekim 2026'dan sonra **eklemedi**. Bu yüzden git geçmişi, yapay zekânın katkısını gerçekte olduğundan **az** gösterir:

- **PR #44 – #76**: Claude Code ile hazırlandı. Kod, testler, commit mesajları ve PR açıklamaları Claude Code tarafından yazıldı ve öğrenci tarafından okunup birleştirildi.
- **PR #13 – #43**: aynı dönemin ve aynı çalışma biçiminin PR'larıdır. ☐ *(Öğrenci teyit edecek: hangileri Claude Code ile hazırlandı.)*
- Dependabot PR'ları (#24–#31, #48–#51, #68) otomatik bağımlılık güncellemeleridir; yapay zekâ değil, GitHub'ın aracı açar.
- Günlük veri commit'leri (`github-actions[bot]`, 61 commit) otomatik iş akışıdır.

## Yapay zekânın yaptığı işler

### Uygulama

- **Kodun büyük kısmı** yapay zekâ araçlarıyla yazıldı ☐ *(öğrenci teyit edecek ya da düzeltecek: elle yazdığım ya da baştan değiştirdiğim kısımlar)*: arayüz, 3B sahne (Three.js), SGP4 ile konum hesabı, 24 saatlik yakın geçiş taraması ve Web Worker'lar, Kessler projeksiyonu, Uydu Radyosu paneli, Spotter, fırlatma listesi, günlük veri iş akışı, CI ve testler. Nasıl çalıştıkları: [`docs/ARCHITECTURE.md`](ARCHITECTURE.md).
- **Çeviriler**: Arayüzün İngilizce dışındaki dillerdeki metinleri (Türkçe, Almanca, Rusça, Çince) yapay zekâ tarafından çevrildi. ☐ *(Öğrenci teyit edecek: hangi diller bir anadili konuşan tarafından kontrol edildi.)*
- **Testler**: 899 birim testi ve tarayıcı testlerinin büyük kısmı yapay zekâ tarafından yazıldı.
- **Dokümantasyon**: README, `docs/` ve `research/` altındaki belgeler yapay zekâ tarafından yazıldı.

### Araştırma altyapısı (Kasım 2026, Claude Code)

Öğrencinin belirlediği yapılacaklar listesine göre:

| İş | Klasör / PR |
|---|---|
| Günlük TLE arşivi ve geçmiş günlerin kurtarılması | `tle-archive` release, PR #69 |
| TLE yaşı ve konum farkı ölçümü | [`research/tle-age/`](../research/tle-age/README.md), PR #70 |
| Performans bayrakları ve ölçüm betikleri | [`research/perf/`](../research/perf/README.md), PR #71 |
| SGP4 doğrulaması (Vallado vd. 2006 test seti) | [`research/sgp4-verify/`](../research/sgp4-verify/README.md), PR #72 |
| Spotter doğruluk protokolü, ölçüm göstergesi ve analiz | [`research/spotter/`](../research/spotter/PROTOCOL.md), PR #73 – #75 |
| Mimari özeti | [`docs/ARCHITECTURE.md`](ARCHITECTURE.md), PR #76 |

Yapay zekâ bu işlerde betikleri yazdı, ölçümleri öğrencinin bilgisayarında çalıştırdı ve sonuç dosyalarını üretti. **Öğrencinin belirlediği** yöntem kuralları (örneğin TLE yaşının satır 1'deki epoch'tan hesaplanması, ana dönemin ayrılması, CPU yavaşlatmalı ek tur) aşağıdaki "Benim verdiğim kararlar" bölümünde öğrenci tarafından yazılacak. Yapay zekânın **kendi önerdiği** ve öğrencinin onayladığı başlıca yöntem seçimleri:

- arşivin bir dalda değil GitHub Release'te, gzip'li 3LE biçiminde tutulması;
- SGP4'ün hata bildirmeden ürettiği anlamsız sonuçları eleyen kural (tahmin edilen konum, yeni yörüngenin en alçak–en yüksek aralığının 1.000 km dışındaysa geçersiz);
- aykırı değerler için Tukey kuralı (Q3 + 3 × IQR) ve ana sonuç olarak ortanca;
- SGP4 doğrulamasında MATLAB çıktısının ana referans, Fortran çıktısının çapraz kontrol olarak kullanılması ve farkın kaynağını göstermek için `afspc` kip tanısı;
- performans ölçümünde nesnelerin NORAD sırasına göre eşit aralıkla seçilmesi, dönüşümlü ölçüm sırası, kare süresinin taramayı beklemeden sabit bir pencerede ölçülmesi;
- Spotter protokolünde gerçek yönü bilinen hedefler (uzak yer işareti, Kutup Yıldızı, su terazisi) ve gerçek yönün WGS-84 üzerinde hesaplanması.

### Kod dışı

- Proje başvuru formu metni ve forum duyurusu için **geri bildirim ve taslak öneriler**. Son metinler öğrenci tarafından yazılır. ☐ *(Öğrenci teyit edecek.)*
- **Rapor metnini yapay zekâ yazmadı**; rapor öğrenci tarafından yazılır.

## Sonuçlar nasıl denetlendi

- **Otomatik testler**: 899 birim testi; tarayıcı testleri (Playwright); her değişiklikte lint, tip kontrolü ve build. GitHub'da her PR için aynı kontroller çalışır.
- **Bağımsız referansla doğrulama**: Uygulamanın SGP4 kütüphanesi, Vallado vd. (2006) makalesiyle yayımlanan 33 test durumunun 32'sinde 1 mm içinde aynı sonucu veriyor; kalan bir durumdaki farkın kaynağı gösterildi ([`research/sgp4-verify/`](../research/sgp4-verify/README.md)).
- **Tekrarlanabilirlik**: Ölçümlerin hepsi bir komutla yeniden çalıştırılabilir ve aynı veriyle aynı sonucu verir. Veri kaynakları ve dosya özetleri (SHA-256) belgelerde yazılıdır.
- **Elle denetim**: Arayüz değişiklikleri telefon ve masaüstü boyutunda tarayıcıda denendi; ekran görüntüleri incelendi.
- **Yapay zekânın hataları**: Yapay zekâ çalışırken hatalar da yaptı ve bunların bir kısmı denetimde yakalandı. Örnekler: protokolde Spotter'ın GPS uyarı eşiğinin yanlış yazılması (20 m yerine kodda 80 m), tam kuzeyin "360.00°" yazılması, bir ölçüm bayrağının adres değişince kaybolması, tasarlanmamış bir test durumunda (su terazisi) anlamsız bir hata değeri üretilmesi. Hepsi düzeltildi.
