# 굿즈 판매 사이트 (goods-shop)

프레임워크 없이 순수 HTML/CSS/JS로 만든 작은 굿즈 쇼핑몰입니다.
로그인하고, 상품을 고르고, 토스페이먼츠 **테스트 모드**로 결제하고,
내 결제 내역을 보고, 관리자는 전체 결제 내역을 봅니다.

> 세부 설계(테이블 구조, 보안 규칙, 결제 흐름 상세)는 **[ARCH.md](./ARCH.md)** 를 보세요.

---

## ⚠️ 이건 학습용 프로젝트입니다

- 관리자 계정이 `admin@admin.com` / `superadmin` 으로 **고정**돼 있고,
  저장소가 공개라 누구나 알 수 있습니다.
- **실제 개인정보나 진짜 결제 정보를 절대 넣지 마세요.**
- 토스 키는 테스트 키만 씁니다. 실제 돈은 나가지 않습니다.

---

## 배포된 주소

- **사이트**: https://dorororong2.github.io/goods-shop/
- **저장소**: https://github.com/Dorororong2/goods-shop
- **Supabase 프로젝트**: `upvbubocwnmjfoqyucfk` (서울 리전)

## 테스트 계정

| 계정 | 비밀번호 | 역할 |
|---|---|---|
| `admin@admin.com` | `superadmin` | 관리자 (전체 결제 내역 열람) |
| `test@test.com` | `test1234` | 일반 사용자 |

관리자 권한은 가입 트리거가 자동으로 부여합니다.
`admin@admin.com` 으로 가입하면 `profiles.role` 이 `admin` 이 됩니다.

## 기술 스택

| 영역 | 사용 기술 | 이유 |
|---|---|---|
| 프론트엔드 | HTML / CSS / 바닐라 JS (빌드 없음) | GitHub Pages에 그대로 올라감 |
| 호스팅 | GitHub Pages | 무료, 정적 파일만 |
| 로그인 · DB | Supabase (Auth + PostgreSQL) | 무료, 서버 운영 불필요 |
| 서버 로직 | Supabase Edge Functions (Deno) | 시크릿 키가 필요한 결제 승인 전용 |
| 결제 | 토스페이먼츠 결제위젯 v2 (테스트) | — |

외부 라이브러리는 전부 CDN으로 불러옵니다. `npm install` 은 필요 없습니다.

---

## 폴더 구조

```
goods-shop/
├─ index.html              상품 목록 (첫 화면)
├─ login.html              회원가입 / 로그인
├─ checkout.html           결제 (토스 결제위젯)
├─ success.html            결제 성공 → 승인 처리
├─ fail.html               결제 실패
├─ orders.html             내 결제 내역
├─ admin.html              전체 결제 내역 (관리자 전용)
├─ assets/
│  ├─ css/style.css        전 페이지 공용 디자인
│  └─ js/
│     ├─ config.js         Supabase URL / anon 키 / 토스 클라이언트 키
│     ├─ supabase.js       Supabase 클라이언트 초기화
│     └─ auth.js           로그인 상태 확인, 헤더, 페이지 접근 가드
├─ supabase/
│  ├─ migrations/          데이터베이스 설계 SQL
│  └─ functions/
│     └─ confirm-payment/  결제 승인 서버 코드
├─ CLAUDE.md               ← 이 문서
└─ ARCH.md                 세부 구조
```

---

## 설정값이 어디 있나

| 값 | 위치 | 공개해도 되나 |
|---|---|---|
| Supabase Project URL | `assets/js/config.js` | ✅ 괜찮음 |
| Supabase anon 키 | `assets/js/config.js` | ✅ 괜찮음 (보호는 RLS가 담당) |
| 토스 **클라이언트** 키 | `assets/js/config.js` | ✅ 괜찮음 (원래 브라우저용) |
| 토스 **시크릿** 키 | Supabase Secrets (`TOSS_SECRET_KEY`) | ❌ **절대 커밋 금지** |
| DB 비밀번호 | 로컬 메모 / Supabase 대시보드 | ❌ **절대 커밋 금지** |

> anon 키가 공개돼도 괜찮은 이유가 헷갈린다면 ARCH.md의 "왜 anon 키는 공개해도 되나" 참고.

---

## 로컬에서 실행하기

```bash
npx serve .
```

그리고 브라우저에서 `http://localhost:3000` 접속.

> ⚠️ HTML 파일을 **더블클릭해서 여는 방식(`file://`)은 동작하지 않습니다.**
> Supabase 로그인이 브라우저 보안 정책상 `http://` 주소를 요구하기 때문입니다.

---

## 배포하기

```bash
git add -A
git commit -m "무엇을 바꿨는지 한 줄"
git push
```

푸시 후 1분쯤 뒤 https://dorororong2.github.io/goods-shop/ 에 반영됩니다.
반영이 안 보이면 브라우저에서 `Ctrl+F5` (강력 새로고침).

### 데이터베이스를 바꿨을 때

`supabase/migrations/` 의 SQL을 Supabase 대시보드 → **SQL Editor** 에 붙여넣고 실행합니다.

### Edge Function을 바꿨을 때

```bash
supabase functions deploy confirm-payment --use-api
```

> `--use-api` 는 Docker 없이 배포하는 옵션입니다. 이 PC에는 Docker가 없으므로 필수입니다.

---

## 작업 규칙

1. **시크릿 키는 어떤 경우에도 코드에 넣지 않습니다.** Supabase Secrets에만 둡니다.
2. **금액을 브라우저에서 계산해 보내지 않습니다.** 항상 `create_order()` 함수가 계산합니다.
3. 데이터 접근 제한은 JS 조건문이 아니라 **RLS(데이터베이스 보안 규칙)** 로 막습니다.
   JS의 화면 숨김은 편의일 뿐, 보안이 아닙니다.
4. 새 페이지를 만들면 `auth.js` 의 헤더/가드를 재사용합니다.

---

## 자주 겪는 문제

| 증상 | 원인과 해결 |
|---|---|
| 로그인이 안 됨 | `file://` 로 열었을 가능성. `npx serve .` 로 실행하세요 |
| 가입 후 로그인이 안 됨 | Supabase의 "Confirm email" 이 켜져 있음. 꺼야 합니다 |
| 결제창이 안 뜸 | `config.js` 의 토스 클라이언트 키가 비어 있거나 `test_gck_` 로 시작하지 않음 |
| 승인 단계에서 실패 | Supabase Secrets에 `TOSS_SECRET_KEY` 가 등록됐는지 확인 |
| 관리자인데 전체가 안 보임 | `profiles` 테이블의 해당 계정 `role` 이 `admin` 인지 확인 |
| GitHub Pages 빌드 실패 | 루트의 `.nojekyll` 파일을 지우지 마세요. 이 파일이 없으면 GitHub가 Jekyll로 사이트를 다시 만들려다 실패합니다 |
