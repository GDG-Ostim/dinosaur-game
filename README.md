# GDG Ostim · Dino Run

Chrome'un çevrimdışı dinozor oyununun Playrix tarzı bir versiyonu. Okul mailiyle (`@ostimteknik.edu.tr`) giriş yapılır, en iyi skorlar liderlik tablosuna yazılır.

- **Oyun:** `/`
- **QR + canlı liderlik (projeksiyon için):** `/qr.html`
- **Yönetim / çekiliş paneli:** `/admin.html` (admin anahtarı gerekir)

## Geliştirme

```bash
npm install
npm run dev
```

Node 22.13+ gerekir (yerleşik `node:sqlite` kullanılıyor). Veritabanı `data/dino.db` dosyasında tutulur.

## Ortam değişkenleri

| Değişken       | Varsayılan              | Açıklama                                       |
|----------------|-------------------------|------------------------------------------------|
| `PORT`         | `3000`                  | Sunucu portu                                   |
| `DATA_DIR`     | `./data` (Docker: `/data`) | SQLite dosyasının klasörü                    |
| `EMAIL_DOMAIN` | `ostimteknik.edu.tr`  | Giriş yapılabilecek mail uzantısı              |
| `SECRET`       | otomatik                | Token imza anahtarı (yoksa DB'de üretilir)     |
| `ADMIN_KEY`    | otomatik                | Yönetim paneli anahtarı (yoksa üretilir ve açılışta loga yazılır) |

## Liderlik tablosunun kalıcılığı (çekiliş için)

- Tüm veriler `DATA_DIR` altındaki SQLite dosyasındadır; hiçbir kayıt silinmez.
- Her biten oyun `scores` tablosuna yazılır (denetim kaydı).
- **Otomatik yedek:** 10 dakikada bir, yarışma bitirilirken ve sunucu kapanırken `DATA_DIR/backups` altına tam kopya alınır (son 100 yedek tutulur).
- **Yarışmayı bitir:** `/admin.html` → "Yarışmayı Bitir". Bundan sonra oyun oynanabilir ama skorlar tabloya yazılmaz; tablo kesinleşir. Gerekirse yeniden açılabilir.
- **Çekiliş:** Paneldeki ilk 10 listesi mailleriyle birlikte görünür; "CSV İndir" ile tüm liste (Excel uyumlu) indirilir.

> ⚠️ Dokploy'da `/data` için **kalıcı bir volume** bağlanmazsa her deploy'da veriler sıfırlanır.

## Dokploy ile yayınlama

1. Dokploy'da yeni bir **Application** oluştur, kaynak olarak bu repoyu seç, build tipi **Dockerfile**.
2. **Volumes** kısmında `/data` için bir volume bağla (skorlar yeniden deploy'da kaybolmasın).
3. **Environment** kısmına güçlü bir `ADMIN_KEY` (ve isteğe bağlı `SECRET`) ekle.
4. **Domains** kısmında alt domaini (ör. `gdgdinozor.poyrazavsever.com`) container portu `3000` ile ekle, HTTPS'i aç.
5. Deploy et, ardından `https://<domain>/qr.html` sayfasını projeksiyona yansıt.

## Görseller

Görseller Higgsfield ile üretildi. `art/process.py` ham çıktıların beyaz arka planını temizleyip `public/assets` altına keser (`python art/process.py`).
