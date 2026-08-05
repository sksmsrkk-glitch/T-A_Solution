# 01. 액티비티 OTA 상품 카테고리 분석

> 조사 대상: Klook, KKday, GetYourGuide(GYG), Trip.com (Things to Do)
> 조사일: 2026-08-04 | 조사 방법: 각사 공개 사이트·파트너/공급자 문서·공개 API 문서·채널매니저(rezio, ROLLER, Bókun) 연동 문서 교차 검증

---

## 1. OTA별 카테고리 체계 비교

### 1.1 4사 카테고리 비교표

| 카테고리 영역 | Klook | KKday | GetYourGuide | Trip.com |
|---|---|---|---|---|
| **입장권/어트랙션** | Attractions & Tickets (테마파크·워터파크, 전망대, 박물관) | Attractions & Tickets (Amusement Parks, Aquariums & Zoos, Exhibitions) | Attraction tickets (어트랙션명으로 제목 시작 규칙) | Attractions, Night Attractions, Family-friendly |
| **시티카드/패스** | Klook Pass (멀티 어트랙션 패스), Transport passes | 패스형 상품 | City cards | City passes, 교통카드 |
| **투어** | Tours & Experiences (Day trips, Walking/Bike/Food tours, Cruises) | Sightseeing / Half-day / Full-day / Multi-day / Walking / Boat & Yacht / Food Tours | Guided tours, Day Trips, Hop-on hop-off buses/boats | Private Tours, Group Tours, Day tours |
| **액티비티/체험** | Water sports, Outdoor activities, Cultural experiences | Workshops(공방·클래스) 발달 | Water activities, Classes & workshops, Adventure/Outdoor | Experiences, Water Sports, Learning experiences |
| **공연/이벤트** | Events (전용 Event Merchant System 보유) | Exhibition Events | Shows & Musicals | Performances / Shows & Exhibitions |
| **교통** | Airport transfers, Car rentals, 철도(JR Pass 등), 버스·페리 | Airport Transfers, Private Charter(전세차량), Ferries, 철도권 | Transfers | Car Services (렌터카, Airport Transfers), 철도 패스 |
| **통신(WiFi/SIM)** | Travel essentials > WiFi & SIM (eSIM, 포켓와이파이) | eSIM / Wi-Fi & SIM Cards | ~~SIM/eSIM~~ (2026-07-31부로 카테고리 폐지) | eSIM, Phone cards |
| **F&B** | Food & dining (레스토랑 바우처) | Gourmet Food / Food & Dining | Food & Drink (투어 중심) | Dining experiences |
| **웰니스** | Massages & spa | Relaxation & Beauty (Spa, Hot Springs) | — (액티비티에 포함) | — (체험에 포함) |
| **숙박/패키지** | Accommodation, 호텔+티켓 패키지, Staycations | Accommodation (일부 마켓), 항공 포함 패키지 | — | 호텔+티켓 (그룹사 시너지) |
| **기타 서비스** | Insurance, Gift cards | Luggage Services(짐보관), Costume Rental(기모노 등 의상대여), 쇼핑 바우처 | — | — |

### 1.2 관찰 포인트

1. **2축 분류**: 4사 모두 **"목적지(도시) × 카테고리"** 2축 taxonomy를 사용. KKday는 내부적으로 카테고리 코드(`CATEGORY_002~094`) + 도시 코드 체계, API에서는 `prod_type`(대분류 코드) + `tag[]`(세부 분류)로 표현.
2. **카테고리별 판매자격/제한 규칙 존재**:
   - KKday: 렌탈 단독 상품·위탁판매 상품 등록 금지, 반일/전일 투어는 등록 여행업자만 판매 가능
   - GYG: 2026-07-31부로 self-guided 오디오 투어·스캐빈저 헌트·eSIM/SIM 카테고리 폐지
   - → 시스템 설계 시 **"카테고리별 판매 제한(Restricted Category)" 정책 관리** 개념 필요
3. **KKday**는 짐보관·의상대여·공방 클래스 등 **롱테일 로컬 서비스**가 발달, **Klook**은 교통·통신 등 **여행 인프라형 상품**이 발달, **GYG**는 투어·입장권 중심의 **정통 액티비티**에 집중.

---

## 2. 표준 카테고리 체계 (8축) 도출

4사 카테고리를 통합하여 공급자 시스템의 **표준 카테고리 8축**을 다음과 같이 정의한다.

| # | 표준 카테고리 | 하위 분류 예시 | 대표 상품 예 |
|---|---|---|---|
| C1 | **입장권/패스** (Tickets & Passes) | 어트랙션 입장권, 테마파크, 박물관/전시, 전망대, 시티패스, 콤보(복수시설) 티켓 | 디즈니랜드 입장권, N서울타워, Klook Pass |
| C2 | **투어** (Tours) | 가이드 투어, 프라이빗 투어, 그룹 투어, 데이트립(당일치기), 멀티데이 투어, Hop-on Hop-off, 크루즈 관광 | 경복궁 가이드 투어, 남이섬 당일투어 |
| C3 | **액티비티/체험** (Activities & Experiences) | 수상 액티비티, 아웃도어/어드벤처, 클래스/워크숍(쿠킹·공예), 테마 체험(한복 등) | 스노클링, 김치 만들기 클래스 |
| C4 | **공연/이벤트** (Shows & Events) | 콘서트, 뮤지컬, 전시 이벤트, 스포츠 관람 | 난타 공연, 뮤지컬 티켓 |
| C5 | **교통** (Transport) | 공항픽업/샌딩, 전세차량(차터), 렌터카, 철도패스/기차표, 버스/페리 | 인천공항 픽업, JR Pass |
| C6 | **여행편의** (Travel Essentials) | WiFi/eSIM/유심, 짐보관/배송, 의상 대여, 여행자보험 | 일본 eSIM, 공항 짐배송 |
| C7 | **F&B/웰니스** (Dining & Wellness) | 레스토랑 예약/식사권, 다이닝 바우처, 스파/마사지, 온천 | 호텔 뷔페 식사권, 발리 스파 |
| C8 | **패키지/번들** (Packages & Bundles) | 호텔+티켓, 항공 포함 패키지, 멀티 어트랙션 번들, 교통+입장권 콤보 | 에버랜드+셔틀 패키지 |

---

## 3. 카테고리별 상품 형태 특성 매트릭스

카테고리마다 판매 단위·날짜/시간 지정·확정 방식·바우처 형태가 다르며, 이것이 시스템의 재고/판매 관리 모델을 결정한다.

| 특성 | C1 입장권/패스 | C2 투어 | C3 액티비티/체험 | C4 공연/이벤트 | C5 교통 | C6 여행편의 | C7 F&B/웰니스 | C8 패키지 |
|---|---|---|---|---|---|---|---|---|
| **판매 단위** | 인원(person) | 인원 또는 그룹/차량 | 인원 | 좌석/인원 | 차량(vehicle)·인원·일수(day) | 개수(SIM)·일수(WiFi/짐) | 인원·이용권 | 인원·조합 |
| **날짜 지정** | 지정일 또는 **오픈데이트**(유효기간형) | 지정일 필수 | 지정일 필수 | 지정일 필수 | 지정일(픽업)·오픈데이트(패스) | 수령일/개시일 | 지정일 또는 오픈데이트 | 지정일 |
| **시간 지정** | 종일권(운영시간) 다수, 일부 타임슬롯 | **타임슬롯**(출발시간) | 타임슬롯 | **좌석·회차** 지정 | 시각 지정(픽업시간) | 없음 | 타임슬롯(예약제) 또는 없음(바우처) | 구성상품 따름 |
| **재고 유형** | 일자별 수량 or 무제한 | 세션별 정원 | 세션별 정원 | 회차별 좌석(좌석등급) | 차량 대수·좌석 | 물류 재고(기기 수량) or 무제한 | 테이블/슬롯 or 무제한 | 구성상품 재고 교집합 |
| **확정 방식** | 즉시확정 다수 | 즉시확정/온리퀘스트 혼재 | 온리퀘스트 비중 높음 | 즉시확정(좌석 확정) | 온리퀘스트 다수(배차 확인) | 즉시확정 | 온리퀘스트(레스토랑 예약) | 온리퀘스트 다수 |
| **바우처 형태** | QR/바코드(입장 게이트 연동) | 예약확인서(픽업정보 포함) | 예약확인서 | 실물/모바일 티켓(좌석 표기) | 예약확인서, 실물 교환권(JR Pass) | 실물 수령(SIM)·QR(짐보관) | QR/바우처 번호 | 구성상품별 복수 바우처 |
| **예약 필수 입력** | 방문일, (여권-일부 시설) | 참가자명, 픽업 호텔, 언어 | 참가자명, 신체조건(키·몸무게-일부) | 관람자명, 좌석 선택 | **항공편명**, 수하물 수, 픽업 주소 | **기기 정보**(eSIM 호환), 수령 장소 | 방문 시간, 인원, 알레르기 | 구성상품별 필드 합집합 |
| **사용(리딤) 방식** | 게이트 스캔 1회 | 집합 시 확인 | 현장 확인 | 입장 스캔 | 탑승 확인 | 수령/개통 | 매장 제시 | 구성상품별 |

### 핵심 시사점

1. **판매 단위가 인원만이 아니다** — person / group / vehicle / room / day / piece 단위를 지원해야 함 (KKday 등록 규칙에서 명시적으로 요구).
2. **날짜·시간 축이 카테고리를 관통하는 3가지 재고 유형을 만든다**:
   - **타임슬롯형**(START_TIME): 투어·액티비티·공연 — 세션별 정원
   - **일자형**(OPENING_HOURS): 입장권 — 일자별 수량, 시간 미지정
   - **오픈데이트형**(FREESALE): 패스·유효기간형 입장권·eSIM — 수량 무제한 또는 총량 관리, 유효기간 속성 보유
3. **예약 시 필수 입력 필드가 카테고리별로 다르다** → **카테고리별 동적 예약 폼**(KKday `booking_field` 방식)이 필요.
4. **확정 방식(즉시확정 vs 온리퀘스트)은 상품 속성**이며, 온리퀘스트는 확정 SLA(24–48h)와 공급자 수동 확정 워크플로를 요구.
5. **바우처는 "예약 단위 1장" vs "인원 단위 N장"** 두 방식 모두 지원 필요 (Klook: Voucher vs Ticket, GYG: COLLECTIVE 카테고리).

---

## 4. OTA별 상품 구조 모델 비교

시스템 설계의 기준이 될 각사 상품 계층 구조:

```
[Klook - OCTO 표준]          [KKday B2B API]              [GetYourGuide]
Product (액티비티)            Product (prod_no, prod_type)  Product (GYG Tour)
 └─ Option (=패키지)           └─ Package (pkg_no)           └─ Option (언어·미팅포인트·시간)
     └─ Unit (Adult/Child)         └─ SKU (spec: 성인/아동)       └─ Ticket Category (ADULT/CHILD…)
         └─ Unit Item                  └─ Event (날짜/시간)           └─ Availability (dateTime 슬롯)
```

**3사 공통 = Product → Option(Package) → Unit(참가자 유형) 3계층.**

| 계층 | 귀속 속성 |
|---|---|
| **Product** | 카테고리, 타이틀/설명/이미지, 목적지, 타임존, 가용성 유형, 확정 방식(instant 여부), 바우처 전달 방식 |
| **Option/Package** | 언어, 미팅포인트/픽업, 소요시간, 취소정책, 컷오프, 판매기간, 시작시각 목록, 예약 필수필드 |
| **Unit/SKU** | 참가자 유형(성인/아동/유아/시니어/학생/그룹), 연령 범위, 최소/최대 수량, 동반 필수 조건, 단위당 인원수(paxCount), 가격 |

부가 개념: **Add-on**(식사·교통·보험 추가 옵션, GYG), **Deal/프로모션**(early bird, last minute), **가격 검증 토큰**(KKday `guid` — 당일 유효, 가격 정합성 보장).

---

## 5. 출처

**Klook**
- Klook Open API (OCTO 기반): https://klook.gitbook.io/openapi
- Klook Merchant Portal: https://merchant.klook.com/ , Partner Hub: https://www.klook.com/en-US/tetris/promo/klook-partner-hub/
- ROLLER × Klook 연동 문서: https://mysupport.roller.software/hc/en-us/articles/13921390938255
- Klook FAQ (open date vs fixed date): https://www.klook.com/faq/category-59-question-909/

**KKday**
- KKday B2B API v3 (Apiary): https://kkdayb2bapiv3.docs.apiary.io/
- KKday B2D 플랫폼: https://b2d.kkday.com/
- rezio × KKday 채널 셋업/상품 등록 규칙: https://help.rezio.io/en/support/solutions/articles/67000636130 , https://help.rezio.io/en/support/solutions/articles/67000735105

**GetYourGuide**
- Supplier API (OpenAPI 스펙): https://integrator.getyourguide.com/assets/api_documentation/supplier-api-supplier-endpoints.yaml
- Integrator Portal: https://integrator.getyourguide.com/documentation/overview
- Supply Help Center (상품 생성·가용성·가격): https://supply.getyourguide.support/
- 카테고리 정책 변경 보도: https://www.phocuswire.com/getyourguide-removes-tours-categories

**Trip.com / 표준**
- Trip.com Things to Do: https://www.trip.com/things-to-do/ , Vendor Platform: https://www.trip.com/m/vbooking/home
- OCTO 표준: https://octo.travel/specification , https://docs.octo.travel/

> **한계 고지**: Klook·KKday·GYG 소비자 사이트는 봇 차단으로 직접 크롤링이 제한되어, 카테고리 명칭은 공식 API 문서·앱스토어·서드파티 연동 문서 기반이며 마켓(국가)별로 노출 명칭이 다소 다를 수 있음. Trip.com 공급자 백엔드(vbooking) 내부 카테고리 트리는 로그인 필요로 공개 자료 기준.
