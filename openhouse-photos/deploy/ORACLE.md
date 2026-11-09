# Oracle Cloud 무료 서버에 올리기

비용 0원으로 200GB 저장 공간을 쓰는 방법입니다. 처음 한 번 30~60분 정도 걸립니다.
막히는 화면이 있으면 캡처해서 Claude 에게 보여주세요.

준비물: 신용/체크카드(본인 확인용, 무료 범위 안에서는 청구되지 않음), 컴퓨터(맥 또는 윈도우)

---

## 1. Oracle Cloud 가입

1. https://www.oracle.com/kr/cloud/free/ → **무료로 시작하기**
2. 정보 입력 중 **홈 리전(Home Region)** 을 고르는 칸이 나옵니다. **나중에 바꿀 수 없고**, 무료 자원은 홈 리전에서만 쓸 수 있습니다.
   - `South Korea Central (Seoul)` 또는 `South Korea North (Chuncheon)` 중 하나
   - 서울은 무료 서버 자리가 자주 모자랍니다. 춘천이 상대적으로 여유 있다는 이야기가 많습니다.
3. 카드 인증까지 마치면 가입 완료 (승인에 몇 분~몇 시간 걸릴 수 있음)

## 2. 무료 주소 만들기 (DuckDNS)

1. https://www.duckdns.org → 구글/GitHub 계정으로 로그인
2. `sub domain` 칸에 원하는 이름(예: `ohs-photos`) → **add domain**
3. `ohs-photos.duckdns.org` 주소가 생깁니다. IP는 5단계에서 넣습니다.
   이 페이지는 열어두세요.

## 3. 서버 만들기

Oracle 콘솔 왼쪽 위 메뉴 ☰ → **Compute → Instances → Create instance**

| 항목 | 고를 것 |
|---|---|
| Name | `openhouse-photos` |
| Image | **Change image → Canonical Ubuntu → 24.04** |
| Shape | **Change shape → Ampere → VM.Standard.A1.Flex**, OCPU 2 · 메모리 12GB (화면에 "Always Free-eligible" 표시가 있는지 확인) |
| Networking | 새 VCN 만들기(기본값) · **Assign a public IPv4 address 체크** |
| Add SSH keys | **Generate a key pair for me → Save private key** (파일을 꼭 저장. 잃어버리면 접속 불가) |
| Boot volume | **Specify a custom boot volume size 체크 → 200 GB** (무료 한도 전체를 사진용으로) |

**Create** → 1~2분 뒤 상태가 `RUNNING` 이 되면 화면의 **Public IP address** 를 메모합니다.

> "Out of capacity" 오류가 나면: 잠시 후 다시 시도하거나, Shape 를 `VM.Standard.E2.1.Micro` (AMD, 메모리 1GB)로 바꿔도 이 앱은 돌아갑니다.

## 4. 포트 열기 (Oracle 바깥 방화벽)

인스턴스 화면 → **Primary VNIC 의 Subnet** 링크 → **Security Lists** → `Default Security List` → **Add Ingress Rules**

| Source CIDR | IP Protocol | Destination Port Range |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

(두 줄 모두 추가. 메뉴 위치가 조금 다르면 VCN → Security 쪽을 찾아보세요.)

## 5. 주소 연결

DuckDNS 페이지로 돌아가 만든 주소의 `current ip` 칸에 **3단계의 Public IP** 를 넣고 **update ip**.

## 6. 서버 접속

**맥** — 터미널 앱을 열고 (키 파일이 다운로드 폴더에 있다고 가정, 파일명은 실제 이름으로):

```bash
chmod 600 ~/Downloads/ssh-key-*.key
```

```bash
ssh -i ~/Downloads/ssh-key-*.key ubuntu@공인IP
```

**윈도우** — PowerShell 을 열고:

```bash
ssh -i $HOME\Downloads\ssh-key-파일이름.key ubuntu@공인IP
```

처음 접속할 때 `Are you sure you want to continue connecting?` 이 나오면 `yes`.

## 7. 설치 스크립트 실행

접속한 화면에서 두 줄을 차례로 붙여넣습니다.

```bash
curl -fsSLO https://raw.githubusercontent.com/eojiinsong-afk/Ai-/claude/awesome-keller-fe63tm/openhouse-photos/deploy/oracle-setup.sh
```

```bash
sudo bash oracle-setup.sh
```

물어보는 세 가지에 답하면 나머지는 자동입니다.
1. 사이트 주소 → `ohs-photos.duckdns.org`
2. 관리자 비밀번호 (입력해도 화면에 안 보이는 게 정상)
3. 참가 코드

`설치 완료 → https://...` 가 나오면 끝입니다. 몇 분 뒤 그 주소로 들어가 관리자로 로그인하세요.
건축물 목록 위에 **남은 공간 ○○GB** 가 보이면 저장 공간까지 제대로 잡힌 것입니다.

---

## 운영하면서

| 하고 싶은 일 | 방법 |
|---|---|
| 새 기능 반영 | 서버에 접속해 `sudo bash oracle-setup.sh` 다시 실행 (사진·설정 유지) |
| 비밀번호·참가 코드·1인당 장수 변경 | `sudo nano /etc/openhouse-photos.env` → 저장 → `sudo systemctl restart openhouse-photos` |
| 문제가 생겼을 때 | `sudo journalctl -u openhouse-photos -n 50` 결과를 Claude 에게 |

### 꼭 알아둘 것

- **유휴 서버 정지** — Oracle 은 무료 서버의 사용량이 7일 내내 매우 낮으면 서버를 **정지**할 수 있습니다. 사진은 지워지지 않고, 콘솔에서 **Start** 를 누르면 다시 켜집니다. 계정을 *Pay As You Go* 로 전환하면 이 정지 대상에서 빠진다는 이야기가 있지만 Oracle 공식 문서로는 확인하지 못했습니다. 전환하더라도 무료 한도 안에서는 0원이지만, 실수로 유료 자원을 만들지 않도록 **예산 알림(Budgets)** 을 1,000원 정도로 걸어두세요.
- **백업** — 행사가 끝나면 관리자 화면에서 건축물별 **전체 다운로드** 로 ZIP 을 받아두는 것이 가장 확실합니다. Oracle 콘솔의 Boot volume → **Create backup** 으로 서버 전체 백업도 가능합니다(무료 5개).
- **주소** — DuckDNS 주소는 무료지만 개인 서비스입니다. 오래 쓸 계획이면 나중에 도메인을 사서 `/etc/openhouse-photos.env` 의 `DOMAIN` 만 바꾸고 스크립트를 다시 실행하면 됩니다.
