// ============================================================
// 로그인 상태 관리 + 공용 헤더
// ============================================================
// 모든 페이지가 이 파일을 가져다 씁니다.
// - 지금 로그인한 사람이 누구인지 확인
// - 화면 위쪽 메뉴(헤더) 그리기
// - 로그인/관리자 전용 페이지 접근 차단
// ============================================================

import { supabase, escapeHtml } from './supabase.js';

// 같은 페이지에서 여러 번 호출해도 한 번만 조회하도록 저장해둡니다.
let cachedProfile;

/** 지금 로그인한 사용자. 로그인 안 했으면 null */
export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

/** 로그인한 사용자의 프로필(역할 포함). 로그인 안 했으면 null */
export async function getProfile() {
  if (cachedProfile !== undefined) return cachedProfile;

  const user = await getUser();
  if (!user) {
    cachedProfile = null;
    return null;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, role')
    .eq('id', user.id)
    .maybeSingle();

  if (error) console.error('프로필 조회 실패:', error.message);

  // 프로필 행이 아직 없으면(트리거 지연 등) 최소 정보라도 돌려줍니다.
  cachedProfile = data ?? { id: user.id, email: user.email, role: 'user' };
  return cachedProfile;
}

export async function isAdmin() {
  const profile = await getProfile();
  return profile?.role === 'admin';
}

export async function signOut() {
  await supabase.auth.signOut();
  cachedProfile = undefined;
  window.location.href = 'index.html';
}

/**
 * 로그인이 필요한 페이지에서 호출합니다.
 * 로그인 안 했으면 login.html 로 보내고, 로그인 후 원래 페이지로 돌아오게 합니다.
 */
export async function requireLogin() {
  const user = await getUser();
  if (!user) {
    const here = window.location.pathname.split('/').pop() + window.location.search;
    window.location.replace('login.html?next=' + encodeURIComponent(here));
    return null;
  }
  return user;
}

/**
 * 관리자 전용 페이지에서 호출합니다.
 *
 * ⚠️ 이건 "화면 차단"일 뿐 보안이 아닙니다.
 * 진짜 차단은 데이터베이스의 RLS 규칙이 합니다. 일반 사용자가 이 검사를
 * 건너뛰고 admin.html 을 열어도, 데이터베이스가 남의 주문을 돌려주지 않습니다.
 */
export async function requireAdmin() {
  const user = await requireLogin();
  if (!user) return null;

  if (!(await isAdmin())) {
    document.body.innerHTML = `
      <main class="container">
        <div class="result">
          <div class="icon">🔒</div>
          <h1>접근 권한이 없습니다</h1>
          <p>이 페이지는 관리자만 볼 수 있습니다.</p>
          <a class="btn" href="index.html">상품 목록으로</a>
        </div>
      </main>`;
    return null;
  }
  return user;
}

/**
 * 화면 위쪽 메뉴를 그립니다.
 * 각 페이지에서 <div id="header"></div> 를 두고 renderHeader('현재페이지') 를 호출합니다.
 */
export async function renderHeader(active = '') {
  const mount = document.getElementById('header');
  if (!mount) return;

  const profile = await getProfile();
  const admin = profile?.role === 'admin';

  const link = (href, label) =>
    `<a href="${href}" class="${active === href ? 'active' : ''}">${label}</a>`;

  const rightSide = profile
    ? `
      ${link('orders.html', '내 결제 내역')}
      ${admin ? link('admin.html', '관리자') : ''}
      <span class="user-chip ${admin ? 'admin' : ''}">
        ${admin ? '👑 ' : ''}${escapeHtml(profile.email)}
      </span>
      <button type="button" class="btn btn-secondary" id="signout-btn">로그아웃</button>`
    : `${link('login.html', '로그인 / 회원가입')}`;

  mount.innerHTML = `
    <div class="demo-banner">
      학습용 데모 사이트입니다 · 토스페이먼츠 <strong>테스트 모드</strong>라 실제 결제가 되지 않습니다
    </div>
    <header class="site-header">
      <div class="inner">
        <a class="brand" href="index.html">🎁 굿즈샵</a>
        <nav>
          ${link('index.html', '상품')}
          ${rightSide}
        </nav>
      </div>
    </header>`;

  document.getElementById('signout-btn')?.addEventListener('click', signOut);
}
