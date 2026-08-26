# -*- coding: utf-8 -*-
"""
샘플 데이터 생성기 — python3 scripts/gen-seed.py

`js/seed-data.js` 를 다시 굽는다. 손으로 고치지 말 것.

날짜를 고정 문자열이 아니라 **오늘로부터의 일수(off)** 로 담는다.
고정 날짜로 두면 몇 달 뒤 데모를 열었을 때 전부 '지연'으로 보인다.
실제 날짜는 store.js 가 불러올 때 오늘 기준으로 만든다.
"""
import json, os, random, io

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'js', 'seed-data.js')

rnd = random.Random(20260826)   # 매번 같은 데이터가 나오도록 고정

# ── 사람 ────────────────────────────────────────────────────────────────
REQUESTERS = [
    ('U-R1', '한지혜', 'hanjihye@hd.example.com', '원가기획팀'),
    ('U-R2', '김도현', 'kimdohyun@hd.example.com', '원가기획팀'),
    ('U-R3', '박서연', 'parkseoyeon@hd.example.com', '원가기획팀'),
    ('U-R4', '이준호', 'leejunho@hd.example.com', '제품개발팀'),
]
# 외부 인원. 승인 상태가 섞여 있어야 '사용자 권한 관리' 화면이 할 일이 생긴다.
WORKERS = [
    ('U-W1', '정민수', 'jms@dawon.example.com',   '다원기술',   '승인'),
    ('U-W2', '오세영', 'osy@sungjin.example.com', '성진ENG',    '승인'),
    ('U-W3', '강태욱', 'ktw@dawon.example.com',   '다원기술',   '승인'),
    ('U-W4', '윤아름', 'yar@cosmo.example.com',   '코스모E&C',  '승인'),
    ('U-W5', '임현우', 'lhw@sungjin.example.com', '성진ENG',    '승인대기'),
    ('U-W6', '배수진', 'bsj@shinhan.example.com', '신한TS',     '승인대기'),
    ('U-W7', '최강현', 'chk@unknown.example.com', '(미확인)',   '거절'),
]
ADMIN = ('U-A1', '시스템관리자', 'admin@hd.example.com', '원가기획팀', '승인')

# ── 부품 ────────────────────────────────────────────────────────────────
PARTS = [
    '붐 실린더 브라켓', '버킷 링크', '회전 모터 마운팅', '엔진 프레임', '카운터 웨이트',
    '아암 실린더 로드', '트랙 링크', '아이들러 샤프트', '스윙 베어링 하우징', '유압 밸브 블록',
    '캐빈 마운트 브라켓', '라디에이터 서포트', '오일 쿨러 브라켓', '파이널 드라이브 커버',
    '스프로킷 세그먼트', '도저 블레이드 힌지', '퀵 커플러 락핀', '그리스 라인 클램프',
    '머플러 행거', '배터리 트레이', '연료탱크 밴드', '컨트롤 레버 마운트', '스텝 플레이트',
    '핸드레일 어셈블리', '웨이트 고정 볼트', '붐 풋 핀', '아암 부싱', '틸트 실린더 커버',
    '리프트 암 플레이트', '조인트 링크 핀', '펌프 브라켓', '냉각팬 슈라우드',
]
MODELS = ['HX220L', 'HX140LC', 'HX300L', 'HX480L', 'HX55', 'HW145', 'HW210',
          'HL955', 'HL975', 'HL940A', 'R210W', 'R300LC']

STATUS_PLAN = [('요청', 64), ('작업중', 36), ('검토/수정', 18), ('완료', 46)]

NOTES = [
    '신규 개발 기종 초도 산출',
    '설계 변경(REV.B) 반영 필요',
    '경쟁사 대비 원가 검토용',
    '양산 이관 전 최종 확인',
    '공용화 검토 대상 품목',
    '',
    '',
]


def part_no(i):
    """품번 6자리-6자리. 앞 6자리는 계열, 뒤 6자리는 일련."""
    family = 123456 + (i % 7) * 111
    return '%06d-%06d' % (family, 100001 + i)


def build():
    users = []
    for uid, name, email, org in REQUESTERS:
        users.append(dict(id=uid, name=name, email=email, org=org,
                          role='작업 요청자', status='승인', joinedOff=-rnd.randint(300, 400)))
    for uid, name, email, org, st in WORKERS:
        users.append(dict(id=uid, name=name, email=email, org=org,
                          role='작업 수행자', status=st,
                          joinedOff=-rnd.randint(5, 260) if st == '승인' else -rnd.randint(1, 9)))
    uid, name, email, org, st = ADMIN
    users.append(dict(id=uid, name=name, email=email, org=org,
                      role='관리자', status=st, joinedOff=-420))

    approved_workers = [w[0] for w in WORKERS if w[4] == '승인']

    requests, files, mails = [], [], []
    seq = 0
    for status, n in STATUS_PLAN:
        for _ in range(n):
            seq += 1
            req_id = 'REQ-%03d' % seq
            requester = rnd.choice(REQUESTERS)
            part = rnd.choice(PARTS)
            model = rnd.choice(MODELS)

            # 완료 건일수록 옛날에 들어온 요청이다.
            if status == '완료':
                requested_off = -rnd.randint(20, 200)
            elif status == '검토/수정':
                requested_off = -rnd.randint(6, 22)
            elif status == '작업중':
                requested_off = -rnd.randint(1, 18)
            else:
                requested_off = -rnd.randint(0, 12)

            lead = rnd.choice([7, 10, 12, 14, 14, 18, 21])
            due_off = requested_off + lead

            r = dict(id=req_id, partNo=part_no(seq), partName=part, model=model,
                     requesterId=requester[0], requesterEmail=requester[2],
                     requestedOff=requested_off, dueOff=due_off,
                     status=status, assigneeId=None, etaOff=None,
                     submittedOff=None, closedOff=None,
                     note=rnd.choice(NOTES))

            if status != '요청':
                r['assigneeId'] = rnd.choice(approved_workers)
                # 예상완료일 — 절반쯤은 희망완료일을 며칠 넘긴다(현실이 그렇다)
                r['etaOff'] = due_off + rnd.choice([-3, -1, 0, 0, 1, 2, 4, 6])

            n_files = 0
            if status in ('검토/수정', '완료'):
                n_files = rnd.randint(2, 4)
                r['submittedOff'] = min(-1, (r['etaOff'] or due_off) - rnd.randint(0, 3))
            elif status == '작업중' and rnd.random() < 0.35:
                n_files = 1     # 올려는 뒀지만 아직 제출 전

            for v in range(1, n_files + 1):
                up_off = (r['submittedOff'] if r['submittedOff'] is not None
                          else requested_off + rnd.randint(1, max(2, lead - 1)))
                files.append(dict(
                    requestId=req_id,
                    name='PCT_%s_%s_%s_v%d.xlsx' % (r['partNo'], model, part.replace(' ', ''), v),
                    sizeKb=rnd.randint(180, 2400), kind='초안', version=v,
                    uploaderId=r['assigneeId'], uploadedOff=up_off - (n_files - v)))

            # 검토/수정·완료 건의 일부는 요청자 수정본이 얹혀 있다
            if status in ('검토/수정', '완료') and rnd.random() < 0.65:
                for v in range(1, rnd.randint(1, 2) + 1):
                    files.append(dict(
                        requestId=req_id,
                        name='PCT_%s_%s_수정본_v%d.xlsx' % (r['partNo'], model, v),
                        sizeKb=rnd.randint(200, 2600), kind='수정본', version=v,
                        uploaderId=requester[0],
                        uploadedOff=min(-1, (r['submittedOff'] or -2) + v)))

            if status == '완료':
                r['closedOff'] = min(-1, (r['submittedOff'] or -3) + rnd.randint(1, 9))

            if r['submittedOff'] is not None:
                mails.append(dict(requestId=req_id, kind='산출물 제출',
                                  to=requester[2], atOff=r['submittedOff'],
                                  subject='[부품원가계산서] %s %s 산출물 제출 (%s)'
                                          % (r['partNo'], part, model)))
            requests.append(r)

    rnd.shuffle(requests)
    requests.sort(key=lambda x: x['id'])

    # ── 보관 자료(Database 관리) — 파일명이 제각각인 것이 핵심이다 ────────
    archive = []
    sources = ['Teams 공유폴더', '개인 PC', '메일 첨부', '외장하드']
    for i in range(46):
        y = rnd.randint(2013, 2024)
        m = rnd.randint(1, 12)
        d = rnd.randint(1, 28)
        pn = part_no(rnd.randint(1, 160))
        mo = rnd.choice(MODELS)
        pt = rnd.choice(PARTS).replace(' ', '')
        style = i % 10
        if style == 0:
            nm = '부품원가계산서_%04d%02d%02d.xlsx' % (y, m, d)
        elif style == 1:
            nm = 'PCT_%s_%02d%02d%02d.xlsx' % (pn, y % 100, m, d)
        elif style == 2:
            nm = '%s_%s_%04d-%02d-%02d.xls' % (pn, pt, y, m, d)
        elif style == 3:
            nm = '부품원가계산서(%s)_%04d%02d%02d_v2.xlsx' % (mo, y, m, d)
        elif style == 4:
            nm = '%s %s %04d.%02d.%02d 최종.xls' % (pn.replace('-', ''), pt, y, m, d)
        elif style == 5:
            nm = '원가계산서_%s_%04d%02d.xlsx' % (mo, y, m)          # 월까지만
        elif style == 6:
            nm = '%s_%s_%04d%02d%02d(수정2).xlsm' % (pt, pn, y, m, d)
        elif style == 7:
            nm = '스캔본_%s.pdf' % pt                                  # 날짜도 품번도 없음
        elif style == 8:
            nm = '부품원가계산서_%04d%02d%02d.xlsx' % (y, 2, 30)        # 달력에 없는 날짜
        else:
            nm = 'PCT_%s(%s)_%04d%02d%02d_rev%d.xlsx' % (pn, mo, y, m, d, rnd.randint(1, 3))
        archive.append(dict(name=nm, sizeKb=rnd.randint(120, 3200),
                            source=rnd.choice(sources),
                            registeredOff=-rnd.randint(1, 90)))

    return dict(users=users, requests=requests, files=files,
                mails=mails, archive=archive)


data = build()

def fmt(d):
    """레코드 하나를 한 줄로. 줄 단위로 diff 가 읽히면서 파일이 부풀지 않는다."""
    out = ['{']
    for i, (k, v) in enumerate(d.items()):
        out.append('  %s: [' % json.dumps(k, ensure_ascii=False))
        out.append('\n'.join('    ' + json.dumps(r, ensure_ascii=False, separators=(',', ':'))
                              + (',' if j < len(v) - 1 else '')
                              for j, r in enumerate(v)))
        out.append('  ]' + (',' if i < len(d) - 1 else ''))
    out.append('}')
    return '\n'.join(out)


body = fmt(data)

js = '''/**
 * 샘플 데이터 — **scripts/gen-seed.py 가 만든 파일입니다. 손으로 고치지 마세요.**
 *
 * 품번·품명·모델명은 건설기계 부품 체계를 흉내 낸 것이고, 사람 이름과 업체는
 * 전부 가공입니다. 사내 실데이터는 이 저장소에 들어 있지 않습니다.
 *
 * 날짜는 'YYYY-MM-DD' 가 아니라 **오늘로부터의 일수(...Off)** 입니다.
 * 고정 날짜로 두면 몇 달 뒤 이 데모를 열었을 때 전부 지연으로 보입니다.
 * 실제 날짜는 store.js 가 불러올 때 오늘 기준으로 만듭니다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SeedData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return %s;
});
''' % body

io.open(OUT, 'w', encoding='utf-8').write(js)
print('js/seed-data.js — 요청 %d건 / 파일 %d건 / 보관자료 %d건 / 사용자 %d명'
      % (len(data['requests']), len(data['files']), len(data['archive']), len(data['users'])))
