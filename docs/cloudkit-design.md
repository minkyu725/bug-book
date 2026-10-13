# Bug Book CloudKit 동기화 설계

상태: 설계. CloudKit 연결 및 동기화 구현은 아직 적용하지 않았습니다.

## 저장소와 클라이언트

CloudKit 컨테이너의 사용자별 private database를 공통 저장소로 사용합니다. 현재 IndexedDB는 오프라인 기록과 동기화 대기 작업을 저장합니다. iPhone PWA, PC 웹/PWA, 향후 macOS 앱은 동일한 production 컨테이너와 레코드 형식을 사용합니다. development 데이터는 production과 별개이며 출시 전에 스키마 배포가 필요합니다.

Windows PC에서는 웹/PWA의 CloudKit JS 경로를 사용합니다. Windows용 네이티브 SDK를 전제로 하지 않습니다. 모든 클라이언트는 iCloud 인증이 필요하며, 새 설치에는 인증 후 원격 기록을 내려받습니다.

## 레코드 형식

BugBookLog 레코드 하나에 관찰 한 건을 저장합니다. recordName은 기존 로그 ID로 고정합니다. 필드는 schemaVersion, date, energy, tags, context, raw, trigger, hypothesis, updatedAt, deletedAt, audio입니다. audio는 base64 문자열 대신 CloudKit Asset으로 저장합니다. 기존 JSON 백업 형식과 로그 ID는 유지합니다.

updatedAt은 표시와 진단용입니다. 기기 시계만으로 충돌 승자를 결정하지 않습니다. 수정에는 CloudKit recordChangeTag를 사용합니다. 동시 수정 충돌은 양쪽 내용을 보존하고 사용자에게 선택을 요청합니다. 삭제는 tombstone으로 전파하고, 삭제 취소도 별도 변경으로 동기화합니다. tombstone 정리 정책이 정해지기 전에는 원격 tombstone을 제거하지 않습니다.

## 오프라인과 실패 복구

로컬 기록 변경과 동기화 대기 항목을 동일 IndexedDB 트랜잭션으로 커밋합니다. 클라우드 요청 전에는 성공 표시를 하지 않습니다. 동기화 대기는 페이지 종료나 재실행 후에도 남아야 합니다. 원격 응답이 와도 그 사이 새로 수정한 로컬 내용을 덮어쓰지 않습니다. 네트워크 실패와 rate limit은 대기 항목을 유지하며 재시도합니다.

전체 기록을 JSON 파일 하나로 덮어쓰는 방식은 사용하지 않습니다. 페이지별 원격 조회, 변경 및 삭제 추적, Asset 다운로드 재시도 경로가 필요합니다. 음성 다운로드 실패 시 텍스트 기록은 보이고 음성은 재시도 상태로 표시합니다. 웹앱이 닫힌 동안의 지속적인 백그라운드 동기화는 보장하지 않습니다. 앱 실행·온라인 복귀·수동 동기화에서 진행합니다.

## 최초 이전과 계정 전환

기존 앱에서 사용자가 iCloud 연결을 선택하면 기록과 음성이 업로드된다는 안내를 제공합니다. 업로드 전 로컬 JSON 백업을 권장합니다. 원격 기록과 로컬 기록을 비교하고 병합한 뒤 업로드합니다. 같은 ID의 내용이 다르면 충돌을 보존하며 자동 덮어쓰지 않습니다. 새 설치는 같은 계정 로그인 후 내려받습니다. 접근할 수 없는 기존 설치의 데이터는 자동 회수할 수 없고 백업 가져오기가 필요합니다.

로컬 동기화 데이터와 대기 항목은 CloudKit userRecordName에 귀속합니다. 로그아웃 또는 다른 계정 로그인 때 이전 사용자의 대기 기록을 새 계정에 업로드하지 않습니다. 기존 미연결 기록은 최초 연결에만 사용자의 명시적인 이전 선택으로 귀속합니다. 계정별 로컬 분리 또는 계정 전환 차단을 구현한 뒤 연결 기능을 공개합니다.

초안과 삭제 취소용 기록의 기기 간 공유는 초기 범위에서 제외합니다. 저장된 실험실 노트와 음성부터 동기화합니다. 파일 백업과 복원은 계속 제공합니다.

## 연결 전 필요한 설정

- 활성 Apple Developer Program 계정과 해당 팀의 관리 권한
- CloudKit 컨테이너: Apple 문서의 Xcode 앱 설정 경로로 생성 및 활성화
- 스키마와 조회용 인덱스, production 스키마 배포
- 웹용 API 토큰과 GitHub Pages origin 허용 설정
- production 컨테이너 ID와 웹 API 토큰 설정

프런트엔드에는 웹용 API 토큰만 사용합니다. 서버 관리용 private key는 사용하지 않습니다. 설정 미완료·로그인 실패·네트워크 장애 때도 기존 로컬 저장과 파일 이전 기능은 사용할 수 있어야 합니다.

## 필수 검증

기존 데이터 최초 업로드, 새 설치 복원, 두 클라이언트 동시 수정, 삭제와 삭제 취소, 오프라인 수정 후 복귀, 업로드 중 재수정, 부분 Asset 실패, 로그아웃과 계정 전환, development/production 분리, 이전 버전 스키마 호환성을 확인합니다. SDK mock 테스트와 실제 CloudKit 계정·iPhone·PC 브라우저 통합 검증을 구분합니다.

## 공식 자료

- https://developer.apple.com/documentation/cloudkitjs
- https://developer.apple.com/documentation/cloudkit/enabling-cloudkit-in-your-app
- https://developer.apple.com/documentation/cloudkitjs/cloudkit.database/saverecords
- https://developer.apple.com/documentation/cloudkitjs/cloudkit.container/setupauth
