# ARCH.md — 세부 구조

`CLAUDE.md` 가 "무엇을 만들었나"라면, 이 문서는 **"어떻게 돌아가나"** 입니다.

---

## 1. 전체 그림

```
┌─────────────────────────────┐
│  브라우저 (GitHub Pages)     │   ← 서버가 없는 정적 HTML/CSS/JS
│                             │
│  · 화면 그리기               │
│  · 로그인 요청               │
│  · 상품 조회                 │
│  · 토스 결제창 띄우기         │
└──────────┬──────────────────┘
           │
    ┌──────┴───────────────────────────────┐
    │                                      │
    ▼                                      ▼
┌─────────────────────┐        ┌────────────────────────────┐
│ Supabase            │        │ Supabase Edge Function     │
│  · Auth (로그인)     │        │  confirm-payment           │
│  · PostgreSQL       │◄───────┤   (시크릿 키 보관 장소)      │
│  · RLS (접근 제어)   │        └────────────┬───────────────┘
└─────────────────────┘                     │
                                            ▼
                                  ┌──────────────────┐
                                  │ 토스페이먼츠 API   │
                                  │ /payments/confirm│
                                  └──────────────────┘
```

**핵심 원칙: 브라우저는 아무것도 믿지 않는다.**
금액 계산, 권한 판단, 결제 승인은 전부 브라우저 바깥(DB 함수 / Edge Function)에서 합니다.

---

## 2. 왜 anon 키는 공개해도 되나

입문자가 가장 헷갈리는 부분이라 따로 씁니다.

`config.js` 에 적히는 **anon 키**는 "이 Supabase 프로젝트에 말 걸 수 있는 손님용 열쇠"입니다.
브라우저에 노출되는 걸 전제로 설계된 값이라 공개돼도 문제없습니다.

그럼 아무나 남의 결제 내역을 읽을 수 있느냐? 아닙니다. **RLS**가 막습니다.
anon 키로 접속해도 데이터베이스는 매 요청마다 "이 사람이 누구지?"를 확인하고,
`orders` 테이블에서는 **본인 행 또는 관리자에게만** 결과를 돌려줍니다.

반대로 **토스 시크릿 키**는 "결제를 최종 승인하는 권한"이라 노출되면
남이 마음대로 결제를 승인/취소할 수 있습니다. 그래서 절대 브라우저에 두지 않습니다.

| | anon 키 | 토스 시크릿 키 |
|---|---|---|
| 어디에 두나 | `assets/js/config.js` (깃허브에 올라감) | Supabase Secrets |
| 노출되면 | 괜찮음 | **위험** |
| 무엇이 보호하나 | RLS 규칙 | 노출 자체를 막는 것 |

---

## 3. 데이터베이스 스키마

SQL 원본: `supabase/migrations/20260928000000_init.sql`

### `products` — 상품

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | bigint | 상품 번호 (자동 증가) |
| `name` | text | 상품명 |
| `description` | text | 설명 |
| `price` | integer | 가격 (원 단위 정수) |
| `emoji` | text | 이미지 대신 쓰는 아이콘 |
| `color` | text | 카드 배경색 (`#6366f1` 형태) |
| `stock` | integer | 재고 |
| `is_active` | boolean | 판매 중 여부 |

> 이미지 파일 대신 이모지+색상을 쓰는 이유: 이미지 준비 없이 바로 돌려보기 위함.
> 나중에 `image_url` 컬럼을 추가해 교체할 수 있습니다.

### `profiles` — 회원

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid | `auth.users.id` 와 동일 (로그인 계정 번호) |
| `email` | text | 이메일 |
| `role` | text | `user` 또는 `admin` |

Supabase는 로그인 계정을 `auth.users` 라는 **내부 테이블**에 보관합니다.
우리가 직접 수정할 수 없으므로, 역할 같은 추가 정보를 담을 우리 테이블을 따로 둡니다.

가입하면 `on_auth_user_created` 트리거가 이 행을 자동으로 만들고,
이메일이 `admin@admin.com` 이면 `role` 을 `admin` 으로 넣습니다.

### `orders` — 주문/결제

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid | 내부 주문 ID |
| `user_id` | uuid | 주문한 사람 |
| `order_code` | text | **토스에 보내는 주문번호** (고유) |
| `product_id` | bigint | 상품 |
| `product_name` | text | 주문 당시 상품명 (나중에 상품명이 바뀌어도 기록 보존) |
| `quantity` | integer | 수량 |
| `amount` | integer | 결제 금액 |
| `status` | text | `PENDING` → `DONE` / `FAILED` / `CANCELED` |
| `payment_key` | text | 토스가 발급한 결제 식별자 |
| `method` | text | 카드 / 간편결제 등 |
| `approved_at` | timestamptz | 승인 시각 |
| `raw` | jsonb | 토스 응답 원본 (문제 생겼을 때 확인용) |

**상태 흐름**

```
create_order() 호출
      ↓
   PENDING  ──(토스 승인 성공)──► DONE
      │
      └─────(토스 승인 실패)──► FAILED
```

---

## 4. 보안 규칙 (RLS) 전문

| 테이블 | 동작 | 누가 가능한가 |
|---|---|---|
| `products` | SELECT | 누구나 (`is_active = true` 인 것만) |
| `products` | INSERT/UPDATE/DELETE | **아무도 못 함** (대시보드에서 직접) |
| `profiles` | SELECT | 본인 또는 관리자 |
| `profiles` | INSERT/UPDATE/DELETE | **아무도 못 함** (트리거가 생성) |
| `orders` | SELECT | 본인 또는 관리자 |
| `orders` | INSERT/UPDATE/DELETE | **아무도 못 함** (함수 / Edge Function이 처리) |

정책을 아예 만들지 않으면 그 동작은 **전부 차단**됩니다. 이게 Supabase RLS의 기본값입니다.
그래서 "브라우저가 직접 orders를 INSERT 해서 공짜 주문 만들기" 같은 게 불가능합니다.

### `is_admin()` 과 무한 반복 문제

관리자인지 확인하려면 `profiles.role` 을 읽어야 합니다.
그런데 `profiles` 를 읽으려면 다시 "관리자인가?"를 확인해야 합니다. → **무한 반복**

해결: `is_admin()` 을 `SECURITY DEFINER` 로 만듭니다.
"이 함수는 만든 사람(관리자) 권한으로 실행된다"는 뜻이라 RLS를 건너뛰고 조회합니다.

---

## 5. `create_order()` — 금액 위조를 막는 장치

```
브라우저가 보내는 것:  상품ID = 2,  수량 = 3
브라우저가 보내지 않는 것:  금액   ← 중요!
```

함수가 하는 일:

1. 로그인했는지 확인 (`auth.uid()` 가 있는지)
2. 수량이 1~10 범위인지 확인
3. `products` 에서 **직접** 가격을 읽음
4. 재고가 충분한지 확인
5. `금액 = 가격 × 수량` 계산
6. 주문번호 생성 (`ORD-20260928143012-a1b2c3d4` 형태)
7. `PENDING` 상태로 `orders` 에 저장
8. 주문번호 · 금액 · 상품명을 브라우저에 돌려줌

사용자가 개발자도구로 금액을 100원으로 바꿔도, **애초에 금액을 받지 않으므로** 소용이 없습니다.

---

## 6. 결제 흐름 상세

```
① checkout.html
   supabase.rpc('create_order', { p_product_id, p_quantity })
        → { order_code, amount, product_name }

② 토스 결제위젯 렌더
   TossPayments(클라이언트키).widgets({ customerKey: 로그인유저ID })
   widgets.setAmount({ currency:'KRW', value: amount })   ← ①에서 받은 금액
   widgets.renderPaymentMethods(...) / renderAgreement(...)

③ 결제하기 버튼
   widgets.requestPayment({
     orderId:   order_code,
     orderName: product_name,
     successUrl: <사이트주소>/success.html,
     failUrl:    <사이트주소>/fail.html
   })

   → 토스 결제창이 뜸 → 테스트 카드 입력

④ 성공하면 토스가 리다이렉트
   success.html?paymentKey=...&orderId=...&amount=...

⑤ success.html 이 Edge Function 호출
   POST /functions/v1/confirm-payment
   Authorization: Bearer <로그인 토큰>
   { paymentKey, orderCode, amount }

⑥ Edge Function 검증 (아래 7번 참고) → 토스 승인 API 호출

⑦ orders.status = 'DONE' 으로 변경 → 화면에 "결제 완료" 표시
```

실패하면 `fail.html?code=...&message=...&orderId=...` 로 돌아옵니다.

---

## 7. Edge Function `confirm-payment` 명세

**경로** `supabase/functions/confirm-payment/index.ts`
**호출 주소** `POST {SUPABASE_URL}/functions/v1/confirm-payment`

### 요청

```
Headers:
  Authorization: Bearer <사용자의 로그인 토큰>
  Content-Type: application/json

Body:
  { "paymentKey": "...", "orderCode": "ORD-...", "amount": 36000 }
```

### 검증 순서 (하나라도 실패하면 즉시 거절)

| # | 검증 | 막는 공격 |
|---|---|---|
| 1 | 로그인 토큰이 유효한가 | 비로그인 호출 |
| 2 | 그 주문번호가 존재하는가 | 아무 번호나 찍어보기 |
| 3 | **그 주문이 이 사용자 것인가** | 남의 주문 가로채기 |
| 4 | **DB의 금액과 요청 금액이 같은가** | 금액 위조 |
| 5 | 상태가 `PENDING` 인가 | 같은 결제 중복 승인 |

### 토스 승인 호출

```
POST https://api.tosspayments.com/v1/payments/confirm
Authorization: Basic base64(TOSS_SECRET_KEY + ":")   ← 콜론(:) 빠뜨리기 쉬움
Content-Type: application/json

{ "paymentKey": "...", "orderId": "<order_code>", "amount": 36000 }
```

> `orderId` 는 우리 DB의 `order_code` 값입니다. 이름이 달라서 헷갈리기 쉽습니다.

### 결과

- 성공 → `orders` 를 `DONE` 으로 업데이트 (`payment_key`, `method`, `approved_at`, `raw` 저장)
- 실패 → `FAILED` 로 업데이트 (`fail_reason` 저장) 후 에러 메시지 반환

### 환경변수 (Supabase Secrets)

| 이름 | 설명 | 등록 방법 |
|---|---|---|
| `TOSS_SECRET_KEY` | 토스 테스트 시크릿 키 (`test_gsk_...`) | `supabase secrets set TOSS_SECRET_KEY=...` |
| `SUPABASE_URL` | 자동 제공 | — |
| `SUPABASE_SERVICE_ROLE_KEY` | 자동 제공 (RLS 우회해 orders 수정용) | — |

---

## 8. 페이지별 동작

| 페이지 | 로드 시 하는 일 |
|---|---|
| `index.html` | `products` 조회 → 카드 목록 렌더. 비로그인도 열람 가능 |
| `login.html` | 탭 전환. `signUp()` / `signInWithPassword()` 호출 후 `index.html` 로 이동 |
| `checkout.html` | 로그인 확인 → `create_order()` → 토스 위젯 렌더 |
| `success.html` | 쿼리 파라미터 읽기 → Edge Function 호출 → 결과 표시 |
| `fail.html` | 실패 코드/메시지 표시 |
| `orders.html` | 로그인 확인 → 본인 `orders` 조회 (RLS가 자동 필터) |
| `admin.html` | `profiles.role === 'admin'` 확인 → 전체 `orders` 조회 |

> `admin.html` 의 화면 차단은 **편의**일 뿐입니다. 진짜 차단은 RLS가 합니다.
> 일반 사용자가 `admin.html` 을 직접 열어도 데이터베이스가 남의 주문을 돌려주지 않습니다.

---

## 9. 테스트 카드 정보

토스 테스트 모드에서는 아무 카드번호나 형식만 맞으면 승인됩니다.
실제 결제창에 표시되는 안내를 따르면 됩니다. 실제 돈은 나가지 않습니다.
