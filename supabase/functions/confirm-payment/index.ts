// ============================================================
// confirm-payment — 토스 결제 최종 승인
// ============================================================
// 이 코드는 브라우저가 아니라 Supabase 서버에서 실행됩니다.
//
// 왜 서버가 필요한가?
//   토스에 "이 결제 승인해줘"라고 요청하려면 '시크릿 키'가 필요합니다.
//   이 키가 브라우저에 있으면 누구나 훔쳐서 마음대로 결제를 승인/취소할 수
//   있습니다. GitHub Pages는 서버가 없으므로, 이 한 조각만 Supabase에서 돌립니다.
//
// 배포:  supabase functions deploy confirm-payment --use-api
// 시크릿: supabase secrets set TOSS_SECRET_KEY=test_gsk_...
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// GitHub Pages(다른 주소)에서 호출하므로 CORS 허용이 필요합니다.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  // 브라우저가 본 요청 전에 보내는 확인 요청
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (req.method !== 'POST') {
    return json({ message: 'POST 요청만 받습니다.' }, 405);
  }

  const TOSS_SECRET_KEY = Deno.env.get('TOSS_SECRET_KEY');
  if (!TOSS_SECRET_KEY) {
    return json({ message: '서버에 TOSS_SECRET_KEY가 설정되지 않았습니다.' }, 500);
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;

  let payload: { paymentKey?: string; orderCode?: string; amount?: number };
  try {
    payload = await req.json();
  } catch {
    return json({ message: '요청 형식이 올바르지 않습니다.' }, 400);
  }

  const { paymentKey, orderCode, amount } = payload;
  if (!paymentKey || !orderCode || typeof amount !== 'number') {
    return json({ message: 'paymentKey, orderCode, amount가 모두 필요합니다.' }, 400);
  }

  // ----------------------------------------------------------
  // 검증 1. 로그인한 사람이 맞는가?
  // ----------------------------------------------------------
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  const user = userData?.user;
  if (userError || !user) {
    return json({ message: '로그인이 필요합니다.' }, 401);
  }

  // 여기서부터는 RLS를 우회할 수 있는 관리자 권한 클라이언트를 씁니다.
  // (orders 테이블은 브라우저에서 수정할 수 없게 막혀 있으므로)
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ----------------------------------------------------------
  // 검증 2. 그 주문번호가 실제로 존재하는가?
  // ----------------------------------------------------------
  const { data: order, error: orderError } = await admin
    .from('orders')
    .select('id, user_id, order_code, product_name, quantity, amount, status')
    .eq('order_code', orderCode)
    .maybeSingle();

  if (orderError) return json({ message: '주문 조회 중 오류: ' + orderError.message }, 500);
  if (!order)     return json({ message: '존재하지 않는 주문번호입니다.' }, 404);

  // ----------------------------------------------------------
  // 검증 3. 그 주문이 이 사용자의 것인가? (남의 주문 가로채기 차단)
  // ----------------------------------------------------------
  if (order.user_id !== user.id) {
    return json({ message: '본인의 주문이 아닙니다.' }, 403);
  }

  // ----------------------------------------------------------
  // 검증 4. 금액이 일치하는가? (★ 금액 위조 차단)
  //
  // 브라우저가 보낸 amount가 아니라, 주문 생성 시 데이터베이스가
  // 계산해 저장해 둔 금액을 기준으로 비교합니다.
  // ----------------------------------------------------------
  if (order.amount !== amount) {
    return json({ message: '결제 금액이 주문 금액과 다릅니다.' }, 400);
  }

  // ----------------------------------------------------------
  // 검증 5. 이미 처리된 주문은 아닌가? (중복 승인 차단)
  // ----------------------------------------------------------
  if (order.status !== 'PENDING') {
    return json({ message: `이미 처리된 주문입니다. (상태: ${order.status})` }, 409);
  }

  // ----------------------------------------------------------
  // 토스 승인 요청
  // ----------------------------------------------------------
  // 인증 방식: Basic 인증. "시크릿키:" 를 base64로 인코딩합니다.
  // ⚠️ 끝의 콜론(:)을 빠뜨리면 인증에 실패합니다. 자주 하는 실수입니다.
  const basicAuth = btoa(`${TOSS_SECRET_KEY}:`);

  const tossResponse = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      paymentKey,
      orderId: order.order_code,   // 토스는 'orderId', 우리 DB는 'order_code'
      amount: order.amount,
    }),
  });

  const tossResult = await tossResponse.json();

  // ----------------------------------------------------------
  // 결과를 주문에 기록
  // ----------------------------------------------------------
  if (!tossResponse.ok) {
    await admin.from('orders').update({
      status: 'FAILED',
      fail_reason: tossResult.message ?? '알 수 없는 오류',
      raw: tossResult,
    }).eq('id', order.id);

    return json({
      message: tossResult.message ?? '결제 승인에 실패했습니다.',
      code: tossResult.code,
    }, 400);
  }

  const { data: updated, error: updateError } = await admin
    .from('orders')
    .update({
      status: 'DONE',
      payment_key: tossResult.paymentKey,
      method: tossResult.method ?? null,
      approved_at: tossResult.approvedAt ?? new Date().toISOString(),
      raw: tossResult,
    })
    .eq('id', order.id)
    .select('order_code, product_name, quantity, amount, status, method, approved_at')
    .single();

  if (updateError) {
    // 토스 승인은 성공했는데 우리 DB 기록만 실패한 경우입니다.
    // 결제 자체는 유효하므로 그 사실을 알려줍니다.
    return json({
      message: '결제는 승인되었지만 기록 저장에 실패했습니다: ' + updateError.message,
    }, 500);
  }

  return json({ ok: true, order: updated });
});
