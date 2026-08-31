# Authentication ve Upload API

## Authentication

Tenant'a özel endpoint'lerde API key `X-API-Key` HTTP header'ı ile gönderilir.

API key açık metin olarak PostgreSQL'de saklanmaz. Gelen anahtar SHA-256 ile hash'lenir ve `api_keys.key_hash` alanı ile karşılaştırılır.

Başarılı authentication sonrasında ilgili tenant bilgileri request context'e eklenir.

### GET `/api/auth/me`

Doğrulanmış API key'in ait olduğu tenant bilgisini döndürür.

**Header**

```http
X-API-Key: cdn_<api-key>
```

Tenant subdomain kullanılıyorsa Host bilgisi ile API key'in ait olduğu tenant'ın `slug` değeri eşleşmelidir.

**Başarılı yanıt**

```http
200 OK
```

```json
{
  "authenticated": true,
  "tenant": {
    "id": "<tenant-uuid>",
    "name": "Example Tenant",
    "slug": "example",
    "bucketName": "tenant-<tenant-uuid>"
  }
}
```

**Hata durumları**

* `401 Unauthorized` — API key eksik, geçersiz veya revoke edilmiş.
* `403 Forbidden` — Tenant pasif veya subdomain API key'in tenant'ı ile eşleşmiyor.

---

# File Upload

## POST `/api/upload`

Doğrulanmış tenant adına MinIO object storage'a dosya yükler.

İstek `multipart/form-data` biçiminde gönderilir.

**Header**

```http
X-API-Key: cdn_<api-key>
```

**Form alanları**

* `file` — Zorunlu. Yüklenecek dosya.
* `path` — İsteğe bağlı. MinIO içerisindeki object key/path. Gönderilmezse dosyanın orijinal adı kullanılır.

Örnek:

```text
path = images/logo.png
file = logo.png
```

## Tenant izolasyonu

İstemciden `tenant_id`, `tenantId`, `bucket`, `bucketName` veya `bucket_name` kabul edilmez.

Hedef bucket yalnızca authentication middleware tarafından belirlenen tenant bilgisinden elde edilir:

```text
API key
   ↓
Tenant
   ↓
req.tenant.bucketName
   ↓
tenant-<tenant_id>
```

Bu nedenle bir tenant istemci parametresi kullanarak başka tenant'ın bucket'ına dosya yazamaz.

## Başarılı yanıt

```http
201 Created
```

```json
{
  "message": "File uploaded successfully",
  "tenant": {
    "id": "<tenant-uuid>",
    "slug": "example"
  },
  "object": {
    "bucket": "tenant-<tenant-uuid>",
    "key": "images/logo.png",
    "size": 12345,
    "contentType": "image/png",
    "etag": "<etag>"
  }
}
```

## Hata durumları

* `400 Bad Request` — Dosya yok, object path geçersiz veya istemci tenant/bucket seçmeye çalışıyor.
* `401 Unauthorized` — API key eksik veya geçersiz.
* `403 Forbidden` — Tenant/subdomain uyuşmazlığı veya tenant aktif değil.
* `413 Payload Too Large` — Dosya `MAX_UPLOAD_BYTES` sınırını aşıyor.
* `500 Internal Server Error` — Beklenmeyen uygulama veya object storage hatası.

## Not

Bugünkü upload endpoint'i dosyayı tenant'a özel MinIO bucket'ına yazar. CDN üzerinden dosya okuma/serve işlemi sonraki çalışma gününde `GET /cdn/*` katmanı ile eklenecektir.
