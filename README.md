# GDG Ostim · Dino Run

Chrome'un çevrimdışı dinozor oyununun Playrix tarzı bir versiyonu. Okul mailiyle (`@atostimteknik.edu.tr`) giriş yapılır, en iyi skorlar liderlik tablosuna yazılır.

- **Oyun:** `/`
- **QR + canlı liderlik (projeksiyon için):** `/qr.html`

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
| `EMAIL_DOMAIN` | `atostimteknik.edu.tr`  | Giriş yapılabilecek mail uzantısı              |
| `SECRET`       | otomatik                | Token imza anahtarı (yoksa DB'de üretilir)     |

## Dokploy ile yayınlama

1. Dokploy'da yeni bir **Application** oluştur, kaynak olarak bu repoyu seç, build tipi **Dockerfile**.
2. **Volumes** kısmında `/data` için bir volume bağla (skorlar yeniden deploy'da kaybolmasın).
3. **Domains** kısmında alt domaini (ör. `gdgdinozor.poyrazavsever.com`) container portu `3000` ile ekle, HTTPS'i aç.
4. Deploy et, ardından `https://<domain>/qr.html` sayfasını projeksiyona yansıt.

## Görseller

Görseller Higgsfield ile üretildi. `art/process.py` ham çıktıların beyaz arka planını temizleyip `public/assets` altına keser (`python art/process.py`).
