// ============================================================
// Supabase 클라이언트 초기화
// ============================================================
// 이 파일을 통해서만 Supabase에 접속합니다.
// 다른 파일에서는 `import { supabase } from './supabase.js'` 로 가져다 씁니다.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from './config.js';

if (!isConfigured()) {
  // 설정을 안 채웠을 때 조용히 실패하지 않고 화면에 바로 알려줍니다.
  document.addEventListener('DOMContentLoaded', () => {
    document.body.insertAdjacentHTML(
      'afterbegin',
      `<div class="alert alert-error" style="margin:16px">
         <strong>설정이 필요합니다.</strong>
         <code>assets/js/config.js</code> 의 Supabase 주소와 anon 키를 채워주세요.
       </div>`
    );
  });
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,      // 새로고침해도 로그인 유지
    autoRefreshToken: true,    // 만료 전 토큰 자동 갱신
  },
});

// 금액을 "12,000원" 형태로 표시
export function formatWon(value) {
  return new Intl.NumberFormat('ko-KR').format(value ?? 0) + '원';
}

// 날짜를 "2026. 9. 28. 오후 2:30" 형태로 표시
export function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('ko-KR', {
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// HTML에 값을 넣을 때 태그로 해석되지 않도록 처리
// (상품명에 <script>가 들어 있어도 안전하게 글자로만 표시됩니다)
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}
