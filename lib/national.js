/**
 * 국가 육아 지원 — 법정 수치 (2026년 기준)
 * ⚠️ 매년 1월(+2026 아동수당은 4월) 재검증. 출처는 각 항목 sourceNote.
 * 검증일 2026-07-15 (네이버 웹검색 + 복지부/voucher.go.kr/korea.kr 교차).
 *
 * 금액 단위: 원. 월 단위 지급은 monthly=true.
 */

const WON = (man) => man * 10000;

const NATIONAL = {
  // 첫만남이용권 — 출생 시 1회, 국민행복카드 바우처. 출처: voucher.go.kr
  firstMeet: {
    label: '첫만남이용권',
    firstChild: WON(200),   // 첫째 200만
    laterChild: WON(300),   // 둘째 이상 300만 (출생순위는 부모 기준 통산)
    once: true,
    when: '출생 직후',
    sourceNote: 'voucher.go.kr · 첫째 200만/둘째+ 300만',
  },

  // 임신·출산 진료비 바우처(국민행복카드). 출처: 복지부 임신출산 지원
  pregnancyVoucher: {
    label: '임신·출산 진료비 바우처',
    single: WON(100),       // 단태아 100만
    multi: WON(140),        // 다태아 140만
    once: true,
    when: '임신 확인 후',
    sourceNote: '국민행복카드 · 단태 100만/다태 140만, 출산 후 2년 사용',
  },

  // 부모급여 — 가정양육 현금(어린이집 이용 시 보육료 바우처로 차감). 출처: mohw.go.kr
  parentPay: {
    label: '부모급여',
    age0: WON(100),         // 0세(0~11개월) 월 100만
    age1: WON(50),          // 1세(12~23개월) 월 50만
    monthly: true,
    sourceNote: 'mohw.go.kr · 0세 월100만/1세 월50만 (가정양육 현금 기준)',
  },

  // 아동수당 — 소득·재산 무관 보편. 월 10만.
  // ⚠️ 2026 확대: 기존 8세 미만 → 단계적 13세 미만(korea.kr), 첫 단계 시행 2026-04.
  //    자료 간 첫 상한이 "9세 미만"으로 엇갈려 재확인 필요. + 비수도권/인구감소지역 월 +2만.
  //    → 보수적으로 "8세 미만(0~95개월)" 코어 적용, 확대분은 uncertain 플래그.
  childPay: {
    label: '아동수당',
    amount: WON(10),        // 월 10만
    untilMonths: 96,        // 8세 미만 = 0~95개월 (보수 기준)
    monthly: true,
    nonMetroBonus: WON(2),  // 비수도권·인구감소지역 월 +2만 (2026, 지역 판정 필요)
    uncertain: '2026년 지급연령 확대(→9세 이상 단계적)·비수도권 가산은 시행시기/대상 재확인 필요',
    sourceNote: 'korea.kr 2026 개편 · 월10만, 8세미만(확대 진행 중)',
  },

  // 육아휴직급여 — 고용보험 가입 근로자만. 2025 개편(사후지급금 폐지) 2026 동일.
  // 통상임금 기준. 출처: 고용노동부, 다수 계산기 교차.
  parentLeave: {
    label: '육아휴직급여',
    optional: true,         // 근로자 대상 — 위저드에서 별도 토글
    bands: [
      { fromMonth: 1, toMonth: 3, rate: 1.00, cap: WON(250) },  // 1~3개월 100%, 상한 250만
      { fromMonth: 4, toMonth: 6, rate: 1.00, cap: WON(200) },  // 4~6개월 100%, 상한 200만
      { fromMonth: 7, toMonth: 12, rate: 0.80, cap: WON(160) }, // 7~12개월 80%, 상한 160만
    ],
    floor: WON(70),         // 하한(대략) — 정확 하한은 연도별 확인
    monthly: true,
    sourceNote: '고용노동부 2025 개편(사후지급금 폐지) · 1~3월 상한250/4~6월 200/7월~ 160',
  },
};

module.exports = { NATIONAL, WON };
