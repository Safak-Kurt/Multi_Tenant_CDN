# CDN File Serving API

## GET /cdn/*

Authenticated tenant'a ait MinIO bucket'ı içerisindeki object'i HTTP üzerinden stream ederek istemciye sunar.

Örnek endpoint:

```text
GET /cdn/docs/tenant-a.txt
```

## Authentication

İsteklerin aşağıdaki header bilgilerini içermesi gerekir:

- `X-API-Key`
- Tenant ile eşleşen `Host` / subdomain

Örnek:

```bash
curl -i \
  -H "Host: acme-demo.localhost" \
  -H "X-API-Key: $API_KEY_A" \
  http://localhost/cdn/docs/tenant-a.txt
```

## Tenant Isolation

Bucket adı istemci tarafından belirlenmez veya gönderilmez.

İsteğin erişebileceği hedef MinIO bucket'ı, authentication işlemi sonucunda belirlenen tenant bilgisi üzerinden:

```javascript
req.tenant.bucketName
```

kullanılarak seçilir.

Object path ise yalnızca `/cdn/*` URL path'inden elde edilir.

Bu yapı sayesinde istemci farklı bir tenant'a ait bucket adını belirleyerek başka tenant'ın dosyalarına erişemez.

## Successful Response

Object başarıyla bulunduğunda örnek HTTP yanıtı:

```http
HTTP/1.1 200 OK
Content-Type: text/plain
Content-Length: ...
Cache-Control: private, no-cache
ETag: "..."
Last-Modified: ...
Vary: X-API-Key
```

Dosyanın içeriği response body üzerinden stream edilir.

## MIME Type Handling

Response `Content-Type` değeri aşağıdaki öncelik sırasına göre belirlenir:

1. MinIO object metadata içerisindeki `Content-Type`
2. Object dosya uzantısı
3. `application/octet-stream` fallback değeri

Bu yapı sayesinde metin, görsel ve diğer statik dosya türleri istemciye uygun MIME type ile gönderilebilir.

## Conditional Request — ETag

İstemci daha önce aldığı object'in ETag değerini aşağıdaki header ile gönderebilir:

```http
If-None-Match: "<etag>"
```

Object değişmemiş ve gönderilen ETag güncel ETag ile eşleşiyorsa sunucu:

```http
HTTP/1.1 304 Not Modified
```

yanıtı döndürür.

Bu durumda object body tekrar gönderilmez.

Object değiştirilmişse ETag değeri de değişir ve eski ETag ile yapılan conditional request sonucunda güncel içerik:

```http
HTTP/1.1 200 OK
```

ile yeniden gönderilir.

## Conditional Request — Last-Modified

İstemci daha önce aldığı `Last-Modified` değerini aşağıdaki header ile gönderebilir:

```http
If-Modified-Since: <http-date>
```

Object belirtilen tarihten sonra değiştirilmemişse sunucu:

```http
HTTP/1.1 304 Not Modified
```

yanıtını döndürür.

Hem `If-None-Match` hem de `If-Modified-Since` mevcutsa ETag tabanlı `If-None-Match` validator kontrolü öncelikli olarak değerlendirilir.

## Error Responses

### 400 Bad Request

Geçersiz veya uygun olmayan object path gönderildiğinde döndürülür.

```http
HTTP/1.1 400 Bad Request
```

### 401 Unauthorized

`X-API-Key` header'ı eksik veya API key geçersiz olduğunda döndürülür.

```http
HTTP/1.1 401 Unauthorized
```

### 403 Forbidden

API key ile belirlenen tenant ve istekte kullanılan `Host` / subdomain eşleşmediğinde döndürülür.

```http
HTTP/1.1 403 Forbidden
```

Bu kontrol tenant'lar arası yetkisiz erişimin engellenmesini sağlar.

### 404 Not Found

İstenen object authenticated tenant'ın MinIO bucket'ı içerisinde bulunamadığında döndürülür.

```http
HTTP/1.1 404 Not Found
```

## Current Cache Policy

Endpoint'in mevcut cache politikası:

```http
Cache-Control: private, no-cache
```

Authenticated CDN endpoint'inde browser/private cache kullanımına izin verilir; ancak saklanan response yeniden kullanılmadan önce validator kullanılarak sunucu ile revalidation gerçekleştirilir.

Bu doğrulama işlemlerinde `ETag`, `If-None-Match`, `Last-Modified` ve `If-Modified-Since` HTTP mekanizmaları kullanılmaktadır.

Object değişmemişse `304 Not Modified`, object güncellenmişse yeni içerikle birlikte `200 OK` yanıtı alınır.

Redis tabanlı cache-aside ve TTL mekanizması bu endpoint'e sonraki geliştirme aşamasında ayrıca eklenecektir.
