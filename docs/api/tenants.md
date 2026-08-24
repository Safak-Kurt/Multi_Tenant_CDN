# Tenant API — Gün 2

## Base Path

```text
/api/tenants
```

Tüm dış erişimler Nginx reverse proxy üzerinden gerçekleştirilir.

## POST /api/tenants

Yeni tenant, quota kaydı ve API key oluşturur.

### Request

```json
{
  "name": "Acme Demo",
  "slug": "acme-demo",
  "storageQuotaBytes": 104857600,
  "bandwidthQuotaBytes": 1073741824
}
```

### Başarılı Yanıt

**HTTP 201 Created**

Yanıtta tenant bilgileri ile birlikte yeni API key yalnızca oluşturma sırasında döndürülür. API key'in açık metin hali PostgreSQL'de saklanmaz.

## GET /api/tenants

Sistemdeki tenant kayıtlarını listeler.

**HTTP 200 OK**

API key veya API key hash bilgisi listeleme yanıtında döndürülmez.

## GET /api/tenants/:id

Belirtilen tenant kimliğine ait tenant ve quota bilgilerini döndürür.

**HTTP 200 OK**

Bulunamayan tenant için:

**HTTP 404 Not Found**

## PUT /api/tenants/:id

Tenant adı, slug, durum veya quota bilgilerinin güncellenmesini sağlar.

Örnek:

```json
{
  "name": "Acme CDN Demo",
  "storageQuotaBytes": 209715200
}
```

Başarılı işlem:

**HTTP 200 OK**

## DELETE /api/tenants/:id

Tenant kaydını siler. PostgreSQL Foreign Key ilişkilerinde `ON DELETE CASCADE` kullanıldığı için tenant'a bağlı API key ve quota kayıtları da kaldırılır.

Başarılı işlem:

**HTTP 204 No Content**

## Hata Kodları

* `400 Bad Request` — Geçersiz input veya tenant UUID
* `404 Not Found` — Tenant bulunamadı
* `409 Conflict` — Aynı slug veya benzersiz alanın tekrar kullanılması
* `500 Internal Server Error` — Beklenmeyen sunucu hatası

## API Key Güvenliği

API key kriptografik olarak rastgele üretilir ve istemciye yalnızca oluşturulduğu anda gösterilir. PostgreSQL'de yalnızca API key prefix bilgisi ve SHA-256 hash değeri saklanır. GET endpoint'leri açık API key veya hash bilgisini döndürmez.

