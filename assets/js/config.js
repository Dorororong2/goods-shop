// ============================================================
// 설정값
// ============================================================
// 여기 있는 값들은 모두 "브라우저에 공개돼도 안전한" 값입니다.
// 토스 시크릿 키나 DB 비밀번호는 절대 이 파일에 넣지 마세요.
// (자세한 이유는 ARCH.md의 "왜 anon 키는 공개해도 되나" 참고)
// ============================================================

// Supabase 프로젝트 주소
// 대시보드 → Project Settings → API → Project URL
export const SUPABASE_URL = '__SUPABASE_URL__';

// Supabase anon public 키
// 대시보드 → Project Settings → API → anon public
export const SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__';

// 토스페이먼츠 결제위젯 "클라이언트" 키 (test_gck_ 로 시작)
// 개발자센터 → 내 개발정보 → 테스트 탭 → 결제위젯 연동 키
export const TOSS_CLIENT_KEY = '__TOSS_CLIENT_KEY__';

// ------------------------------------------------------------
// 아래는 자동 계산되는 값이라 건드릴 필요 없습니다.
// ------------------------------------------------------------

// 결제 후 토스가 돌아올 주소. 로컬에서든 GitHub Pages에서든
// 지금 열려 있는 주소를 기준으로 알아서 만들어집니다.
export function siteUrl(path) {
  const base = window.location.href.replace(/\/[^/]*$/, '/');
  return new URL(path, base).href;
}

// 설정이 아직 채워지지 않았는지 확인
export function isConfigured() {
  return ![SUPABASE_URL, SUPABASE_ANON_KEY].some((v) => v.startsWith('__'));
}

export function isTossConfigured() {
  return !TOSS_CLIENT_KEY.startsWith('__');
}
